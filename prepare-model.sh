#!/usr/bin/env bash
set -euo pipefail
cd "$1"
fetch() {
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors --connect-timeout 15 --max-time 330 "$1" --output "$2"
  echo "$3  $2" | sha256sum --check --status
}
fetch 'https://github.com/ggml-org/llama.cpp/releases/download/b12675/llama-b12675-bin-ubuntu-x64.tar.gz' llama.tar.gz c4f5ff106835e3ec8a68509bac07286318c884238cec72de4ee0753e80d35157
fetch 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf?download=true' model.gguf 7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5
tar -xzf llama.tar.gz
find "$PWD" -type f -name llama-server -print -quit
