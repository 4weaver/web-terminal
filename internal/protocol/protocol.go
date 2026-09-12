// Copyright (c) 2026 YeonGyu Kim
// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. This Go file is a
// reimplementation derived from the original TypeScript source; the original
// copyright notice is retained. Full license text: LICENSE at the repo root.

// Package protocol mirrors the wire format of web-terminal's src/shared/protocol.ts.
// Binary frames: [opcode:1][payload]. Control frames are JSON text messages.
package protocol

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

// Binary frame opcodes (first byte of a binary WebSocket message).
const (
	OpOutput byte = 0x01
	OpInput  byte = 0x02
)

// outputHeaderBytes is opcode + uint64 big-endian cumulative offset.
const outputHeaderBytes = 9

// Terminal dimension limits, matching the client's validation.
const (
	MinCols = 2
	MaxCols = 1000
	MinRows = 1
	MaxRows = 1000
)

// ClientControl is a decoded client -> server JSON control message.
type ClientControl struct {
	T          string `json:"t"`
	SessionID  string `json:"sessionId,omitempty"`
	LastOffset *int64 `json:"lastOffset,omitempty"`
	Cols       int    `json:"cols,omitempty"`
	Rows       int    `json:"rows,omitempty"`
}

// ServerControl is a server -> client JSON control message.
type ServerControl struct {
	T         string `json:"t"`
	SessionID string `json:"sessionId,omitempty"`
	Offset    *int64 `json:"offset,omitempty"`
	Code      *int   `json:"code,omitempty"`
	Message   string `json:"message,omitempty"`
}

// EncodeOutput builds an output frame: opcode, cumulative offset, payload.
func EncodeOutput(offset int64, payload []byte) []byte {
	frame := make([]byte, outputHeaderBytes+len(payload))
	frame[0] = OpOutput
	binary.BigEndian.PutUint64(frame[1:], uint64(offset))
	copy(frame[outputHeaderBytes:], payload)
	return frame
}

// DecodeInput extracts the payload of an input frame.
func DecodeInput(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty frame")
	}
	if data[0] != OpInput {
		return nil, fmt.Errorf("unknown opcode: %d", data[0])
	}
	return data[1:], nil
}

// ParseClientControl decodes and validates a client control message.
func ParseClientControl(raw []byte) (ClientControl, error) {
	var c ClientControl
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("malformed control: %w", err)
	}
	switch c.T {
	case "hello":
		if c.Cols < MinCols || c.Cols > MaxCols {
			return c, fmt.Errorf("hello: cols out of range: %d", c.Cols)
		}
		if c.Rows < MinRows || c.Rows > MaxRows {
			return c, fmt.Errorf("hello: rows out of range: %d", c.Rows)
		}
	case "resize":
		if c.Cols < MinCols || c.Cols > MaxCols {
			return c, fmt.Errorf("resize: cols out of range: %d", c.Cols)
		}
		if c.Rows < MinRows || c.Rows > MaxRows {
			return c, fmt.Errorf("resize: rows out of range: %d", c.Rows)
		}
	case "ping":
	default:
		return c, fmt.Errorf("unknown control type: %q", c.T)
	}
	return c, nil
}
