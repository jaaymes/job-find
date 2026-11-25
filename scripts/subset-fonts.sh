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
# Cobre Basic Latin, Latin-1, Latin Extended-A, pontuação geral, € e • (pt/en/es).
set -euo pipefail

SRC="${1:?uso: subset-fonts.sh <origem> <destino>}"
DEST="${2:?uso: subset-fonts.sh <origem> <destino>}"
PY="${PYTHON:-python3}"
UNICODES="U+0000-00FF,U+0100-017F,U+2000-206F,U+20AC,U+2022"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

# make_static <variável> <nome-de-saída> <eixos...>
make_static() {
  local var="$1" out="$2"
  shift 2
  "$PY" -m fontTools.varLib.instancer -q "$var" "$@" -o "$TMP/inst.ttf"
  "$PY" -m fontTools.subset "$TMP/inst.ttf" --unicodes="$UNICODES" \
    --layout-features='*' --no-hinting --output-file="$DEST/$out"
}

SERIF="$SRC/sourceserif4/SourceSerif4[opsz,wght].ttf"
SANS="$SRC/sourcesans3/SourceSans3[wght].ttf"
PLEX="$SRC/ibmplexsans/IBMPlexSans[wdth,wght].ttf"

make_static "$SERIF" SourceSerif4-Regular.ttf wght=400 opsz=12
make_static "$SERIF" SourceSerif4-Bold.ttf wght=700 opsz=12
make_static "$SANS" SourceSans3-Regular.ttf wght=400
make_static "$SANS" SourceSans3-Bold.ttf wght=700
make_static "$PLEX" IBMPlexSans-Regular.ttf wght=400 wdth=100
make_static "$PLEX" IBMPlexSans-Bold.ttf wght=700 wdth=100
