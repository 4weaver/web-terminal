// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package web

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/4weaver/web-terminal-go/internal/session"
	"github.com/coder/websocket"
)

// Config is the runtime configuration, read from WT_* environment variables so
// the variable names match web-terminal's.
type Config struct {
	Host      string
	Port      int
	FilesRoot string
	// StaticDir serves the browser frontend. Empty disables static serving.
	StaticDir string
	// NoCache disables static-asset caching (WT_NO_CACHE). Every nix store file
	// carries the epoch mtime, so Last-Modified is identical across builds and a
	// conditional request is answered 304 forever — the browser keeps a stale
	// frontend after a redeploy. Turn this on for a dev/test instance.
	NoCache bool
	// IdleTimeout is how long a session with no attached client survives before
	// it is reaped (WT_IDLE_TIMEOUT seconds; 0 disables).
	IdleTimeout time.Duration
	// AllowedOrigins is checked on WebSocket upgrade; empty allows same-origin only.
	AllowedOrigins []string
}

// LoadConfig reads WT_* environment variables.
func LoadConfig() (Config, error) {
	cfg := Config{
		Host:      envOr("WT_HOST", "127.0.0.1"),
		FilesRoot: envOr("WT_FILES_ROOT", mustHome()),
		StaticDir: envOr("WT_STATIC_DIR", ""),
		NoCache:   os.Getenv("WT_NO_CACHE") != "",
	}
	port, err := strconv.Atoi(envOr("WT_PORT", "7777"))
	if err != nil || port < 0 || port > 65535 {
		return cfg, errors.New("WT_PORT must be a valid port number")
	}
	cfg.Port = port
	idleSeconds, err := strconv.Atoi(envOr("WT_IDLE_TIMEOUT", "1800"))
	if err != nil || idleSeconds < 0 {
		return cfg, errors.New("WT_IDLE_TIMEOUT must be a non-negative number of seconds")
	}
	cfg.IdleTimeout = time.Duration(idleSeconds) * time.Second
	if origins := os.Getenv("WT_ALLOWED_ORIGINS"); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if o = strings.TrimSpace(o); o != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
			}
		}
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustHome() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return h
}

// Server holds the HTTP routing state.
type Server struct {
	cfg   Config
	store *session.Store
}

// NewServer wires routes around a session store.
func NewServer(cfg Config, store *session.Store) *Server {
	return &Server{cfg: cfg, store: store}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/api/health", s.handleHealth)
	if s.cfg.StaticDir != "" {
		var h http.Handler = http.FileServer(http.Dir(s.cfg.StaticDir))
		if s.cfg.NoCache {
			h = noStaleCache(h)
		}
		mux.Handle("/", h)
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "not found", http.StatusNotFound)
		})
	}
	return mux
}

// noStaleCache drops cache validators from static requests so a new build is
// always picked up (WT_NO_CACHE); see Config.NoCache.
func noStaleCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Del("If-Modified-Since")
		r.Header.Del("If-None-Match")
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"sessions": len(s.store.List()),
	})
}

// handleWS upgrades the request and runs the session protocol.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	opts := &websocket.AcceptOptions{CompressionMode: websocket.CompressionContextTakeover}
	if len(s.cfg.AllowedOrigins) > 0 {
		opts.OriginPatterns = s.cfg.AllowedOrigins
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		log.Printf("ws: accept: %v", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 24*time.Hour)
	defer cancel()
	ServeWS(ctx, conn, s.store)
}

// AbsPath resolves p under the files root, rejecting escapes.
func AbsPath(root, p string) (string, error) {
	clean := filepath.Clean("/" + p)
	full := filepath.Join(root, clean)
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", errors.New("path escapes files root")
	}
	return full, nil
}
