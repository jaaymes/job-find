#!/usr/bin/env bash
# Gera os TTF estáticos com subconjunto latino usados nos PDFs (dev-only, nunca roda em runtime).
#
# Uso:  PYTHON=<python-com-fonttools> scripts/subset-fonts.sh <origem> <destino>
#   <origem>  diretório com as fontes variáveis do google/fonts, em subpastas:
#             sourceserif4/SourceSerif4[opsz,wght].ttf
#             sourcesans3/SourceSans3[wght].ttf
#             ibmplexsans/IBMPlexSans[wdth,wght].ttf
#   <destino> normalmente public/fonts
#   PYTHON    interpretador com fonttools instalado (padrão: python3)
#
# Cobre Basic Latin, Latin-1, Latin Extended-A, pontuação geral, € e •, marcas combinantes (U+0300-036F),
# setas (U+2190-21FF), ≤ ≥, ✓ e ★ (pt/en/es), quando a fonte tem o glifo.
#
# OFL, cláusula 3: Source Sans 3 (RFN "Source") e IBM Plex Sans (RFN "Plex") ficam modificadas (instância + subconjunto),
# então as derivadas são renomeadas: "JF Sans" e "JF Grotesk". Source Serif 4 e Inter não reservam nome e o mantêm.
set -euo pipefail

SRC="${1:?uso: subset-fonts.sh <origem> <destino>}"
DEST="${2:?uso: subset-fonts.sh <origem> <destino>}"
PY="${PYTHON:-python3}"
UNICODES="U+0000-00FF,U+0100-017F,U+0300-036F,U+2000-206F,U+20AC,U+2022,U+2190-21FF,U+2264-2265,U+2713,U+2605"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

# set_names <arquivo> <família> <Regular|Bold> <prefixo-PostScript>
# Reescreve a tabela `name` (ids 1/2/3/4/6; remove 16/17/21/22/25) para RIBBI correto e sem o nome reservado.
set_names() {
  "$PY" - "$@" <<'PYEOF'
import sys
from fontTools.ttLib import TTFont

path, family, style, ps = sys.argv[1:5]
font = TTFont(path)
name = font["name"]
for nid in (16, 17, 21, 22, 25):
    name.removeNames(nameID=nid)
full = f"{family} {style}"
version = next((str(n) for n in name.names if n.nameID == 5), "Version 1.000")
values = {1: family, 2: style, 3: f"{version};{ps}-{style}", 4: full, 6: f"{ps}-{style}"}
for nid, value in values.items():
    name.removeNames(nameID=nid)
    name.setName(value, nid, 3, 1, 0x409)
    name.setName(value, nid, 1, 0, 0)
os2 = font["OS/2"]
bold = style == "Bold"
os2.usWeightClass = 700 if bold else 400
os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if bold else 0b1000000)
font["head"].macStyle = 1 if bold else 0
font.save(path)
PYEOF
}

# make_static <variável> <família> <prefixo-PostScript> <Regular|Bold> <arquivo-de-saída> <eixos...>
make_static() {
  local var="$1" family="$2" ps="$3" style="$4" out="$5"
  shift 5
  "$PY" -m fontTools.varLib.instancer -q "$var" "$@" -o "$TMP/inst.ttf"
  "$PY" -m fontTools.subset "$TMP/inst.ttf" --unicodes="$UNICODES" \
    --layout-features='*' --no-hinting --output-file="$DEST/$out"
  set_names "$DEST/$out" "$family" "$style" "$ps"
}

SERIF="$SRC/sourceserif4/SourceSerif4[opsz,wght].ttf"
SANS="$SRC/sourcesans3/SourceSans3[wght].ttf"
PLEX="$SRC/ibmplexsans/IBMPlexSans[wdth,wght].ttf"

make_static "$SERIF" "Source Serif 4" SourceSerif4 Regular SourceSerif4-Regular.ttf wght=400 opsz=12
make_static "$SERIF" "Source Serif 4" SourceSerif4 Bold SourceSerif4-Bold.ttf wght=700 opsz=12
make_static "$SANS" "JF Sans" JFSans Regular JFSans-Regular.ttf wght=400
make_static "$SANS" "JF Sans" JFSans Bold JFSans-Bold.ttf wght=700
make_static "$PLEX" "JF Grotesk" JFGrotesk Regular JFGrotesk-Regular.ttf wght=400 wdth=100
make_static "$PLEX" "JF Grotesk" JFGrotesk Bold JFGrotesk-Bold.ttf wght=700 wdth=100
