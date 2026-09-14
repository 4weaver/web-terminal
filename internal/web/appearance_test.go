// Copyright (c) 2026 anansi
//
// Part of a fork of web-terminal (https://github.com/code-yeongyu/web-terminal),
// Copyright (c) 2026 YeonGyu Kim, MIT licensed. The Go backend, protocol design
// and frontend architecture in this fork derive from that project; this file is
// new work. Full license text: LICENSE at the repo root.

package web

import "testing"

func TestLoadAppearanceDefaults(t *testing.T) {
	t.Setenv("WT_THEME", "")
	t.Setenv("WT_FONT", "")
	t.Setenv("WT_FONT_SIZE", "")
	t.Setenv("WT_ALPHA", "")
	got := LoadAppearance()
	if got.Theme != defaultTheme || got.Font != defaultFont || got.FontSize != defaultFontSize || got.Alpha {
		t.Fatalf("defaults = %+v", got)
	}
}

func TestLoadAppearanceValid(t *testing.T) {
	t.Setenv("WT_THEME", "gruvbox-dark")
	t.Setenv("WT_FONT", "iosevka")
	t.Setenv("WT_FONT_SIZE", "16")
	t.Setenv("WT_ALPHA", "1")
	got := LoadAppearance()
	if got.Theme != "gruvbox-dark" || got.Font != "iosevka" || got.FontSize != 16 || !got.Alpha {
		t.Fatalf("got %+v", got)
	}
}

func TestLoadAppearanceAlpha(t *testing.T) {
	t.Setenv("WT_ALPHA", "true")
	if !LoadAppearance().Alpha {
		t.Fatal("true")
	}
	t.Setenv("WT_ALPHA", "off")
	if LoadAppearance().Alpha {
		t.Fatal("off")
	}
}

func TestLoadAppearanceUnknownFallsBack(t *testing.T) {
	t.Setenv("WT_THEME", "solarized")
	t.Setenv("WT_FONT", "comic-sans")
	t.Setenv("WT_FONT_SIZE", "nope")
	got := LoadAppearance()
	if got.Theme != defaultTheme || got.Font != defaultFont || got.FontSize != defaultFontSize {
		t.Fatalf("fallback = %+v", got)
	}
}
