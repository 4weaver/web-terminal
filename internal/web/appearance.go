// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package web

import (
	"os"
	"strconv"
	"strings"
)

const (
	defaultTheme    = "catppuccin-mocha"
	defaultFont     = "lilex"
	defaultFontSize = 14
)

var validThemes = map[string]struct{}{
	"catppuccin-mocha": {},
	"tokyo-night":      {},
	"gruvbox-dark":     {},
}

var validFonts = map[string]struct{}{
	"lilex":          {},
	"jetbrains-mono": {},
	"iosevka":        {},
}

// Appearance is the instance look served at GET /api/config.
type Appearance struct {
	Theme    string `json:"theme"`
	Font     string `json:"font"`
	FontSize int    `json:"fontSize"`
	Alpha    bool   `json:"alpha"`
}

// LoadAppearance reads WT_THEME, WT_FONT, WT_FONT_SIZE, and WT_ALPHA.
// Unknown names and unparseable sizes fall back to the defaults
// (mocha / lilex / 14). Alpha defaults to false.
func LoadAppearance() Appearance {
	a := Appearance{
		Theme:    envOr("WT_THEME", defaultTheme),
		Font:     envOr("WT_FONT", defaultFont),
		FontSize: defaultFontSize,
		Alpha:    envBool("WT_ALPHA", false),
	}
	if _, ok := validThemes[a.Theme]; !ok {
		a.Theme = defaultTheme
	}
	if _, ok := validFonts[a.Font]; !ok {
		a.Font = defaultFont
	}
	if v := os.Getenv("WT_FONT_SIZE"); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			a.FontSize = n
		}
	}
	return a
}

func envBool(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "":
		return fallback
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
