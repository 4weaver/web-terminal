// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

// Command web-terminal-go is a mobile-first self-hosted web terminal.
//
// Browser side is coder/ghostty-web (Ghostty's VT engine compiled to WASM); this
// process is the backend: PTY + WebSocket + replay buffer. No JavaScript runtime
// is involved on the server.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/4weaver/web-terminal-go/internal/session"
	"github.com/4weaver/web-terminal-go/internal/web"
)

const defaultStaticDir = "web"

func main() {
	log.SetFlags(log.Ltime)

	cfg, err := web.LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.StaticDir == "" {
		if _, err := os.Stat(defaultStaticDir); err == nil {
			cfg.StaticDir = defaultStaticDir
		}
	}

	store := session.NewStore(session.DefaultSessionCommand(), cfg.FilesRoot)
	srv := &http.Server{
		Addr:              cfg.Host + ":" + itoa(cfg.Port),
		Handler:           web.NewServer(cfg, store).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store.IdleGrace = cfg.IdleTimeout
	store.StartReaper(ctx, 30*time.Second)

	go func() {
		log.Printf("web-terminal-go listening on http://%s (static=%q, sessions=%d)",
			srv.Addr, cfg.StaticDir, len(store.List()))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
