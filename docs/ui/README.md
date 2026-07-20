# localOCR UI design

Polished product UI inspired by [setcalculators.com](https://setcalculators.com/) — calm utility chrome, privacy-first copy, indigo primary, soft dual radial backgrounds, DM Sans + JetBrains Mono, pill controls, and card surfaces.

## Source of truth

| Asset | Description |
|-------|-------------|
| **[figma-frames.html](./figma-frames.html)** | Editable “Figma board” of all frames + tokens (open in browser) |
| `frame-landing.png` | 01 Landing / home |
| `frame-workspace.png` | 02 Workspace (primary flow) |
| `frame-export.png` | 03 Export |
| `frame-mobile.png` | 04 Mobile home |
| `frame-tokens.png` | Design tokens panel |
| `frame-specs.png` | Interaction & layout rules |
| `figma-board-overview.png` | Full board overview |
| `archive/` | Earlier AI mockups (superseded) |

## Design system (from setcalculators)

| Token | Value |
|-------|--------|
| Primary | `#4f46e5` |
| Primary hover | `#4338ca` |
| Primary light | `#eef2ff` |
| Accent | `#06b6d4` |
| Background | `#f8fafc` |
| Surface | `#ffffff` |
| Text | `#0f172a` |
| Muted | `#64748b` |
| Border | `#e2e8f0` |
| Success (confidence high) | `#10b981` |
| Radius | 8 / 12 / 20 / pills 999 |
| Fonts | **DM Sans** UI · **JetBrains Mono** codes / conf |
| Shadows | soft slate + indigo-tinted `lg` |

### Patterns borrowed

1. **Page wash** — dual radial gradients (indigo + cyan) on slate-50  
2. **Pill controls** — bordered white pills; primary solid indigo  
3. **Tool card** — elevated white card for the main action (dropzone / calculator)  
4. **Trust near action** — privacy and capability notes adjacent to the tool, not buried  
5. **Theme readiness** — CSS variables structured for light/dark (dark tokens reserved)

### localOCR-specific additions

- Persistent **On-device** pill with success pulse  
- Landing top bar: **On-device · WebGPU · How it works** (no History)  
- **Site footer**: Privacy · Terms of use · About us · How it works  
- Workspace **200 | 1fr | 340** grid (pages · canvas · results)  
- Confidence coloring (green / amber) in mono  
- Bbox overlays + cyan highlight for selected line  
- Mobile “last result” preview may use localStorage only (not a History panel)  

## How to edit

1. Open `figma-frames.html` in Chrome.  
2. Tweak CSS variables or layout in that file.  
3. Re-export PNGs (optional):

```bash
# from repo root — requires local Chrome + puppeteer-core
# or simply screenshot frames manually from the HTML board
open docs/ui/figma-frames.html
```

## Implementation notes for engineers

- Prefer implementing from **HTML/CSS tokens** in `figma-frames.html`, not from raster PNGs.  
- PNGs are for review, pitch, and plan embeds.  
- Do not reintroduce dense “AI dashboard” chrome; keep the setcalculators calm utility feel.
