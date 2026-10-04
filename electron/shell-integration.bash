# Scoped to this Bash process. Preserve the user's existing prompt command.
[[ -f ~/.bashrc ]] && source ~/.bashrc
__bt_previous_history=$(HISTTIMEFORMAT= builtin history 1)
__bt_cwd() { pwd -W 2>/dev/null || printf '%s' "$PWD"; }
__bt_previous_cwd=$(__bt_cwd)
__bt_completion_file=$(cygpath -u "$BETTER_TERMINAL_COMPLETION_FILE" 2>/dev/null || printf '%s' "$BETTER_TERMINAL_COMPLETION_FILE")
__bt_input() {
  local encoded
  encoded=$(printf '%s\0%s\0%s\0%s' input "$(__bt_cwd)" "$READLINE_LINE" "$READLINE_POINT" | base64 | tr -d '\r\n')
  printf '\033]778;BT;%s;%s\007' "$BETTER_TERMINAL_TOKEN" "$encoded"
}
__bt_fill() {
  local token expected replacement
  if [[ -f "$__bt_completion_file" ]]; then
    { IFS= read -r token; IFS= read -r expected; IFS= read -r replacement; } < "$__bt_completion_file"
    expected=$(printf '%s' "$expected" | base64 --decode)
    replacement=$(printf '%s' "$replacement" | base64 --decode)
    if [[ "$token" == "$BETTER_TERMINAL_TOKEN" && "$READLINE_LINE" == "$expected" && "$READLINE_POINT" -eq $(printf '%s' "$READLINE_LINE" | wc -c) ]]; then
      READLINE_LINE="$replacement"
      READLINE_POINT=$(printf '%s' "$replacement" | wc -c)
    fi
  fi
  __bt_input
}
__bt_completion_ready=0
if [[ $(bind -v 2>/dev/null) != *'set editing-mode vi'* ]]; then
  bind -x '"\e[24;5~":__bt_input'
  bind -x '"\e[24;6~":__bt_fill'
  __bt_completion_ready=1
fi
__bt_event() {
  local encoded
  # Python/Node are unnecessary: base64 handles the payload, JSON quoting happens in the main process.
  encoded=$(printf '%s\0%s\0%s' "$1" "$(__bt_cwd)" "$2" | base64 | tr -d '\r\n')
  printf '\033]778;BT;%s;%s\007' "$BETTER_TERMINAL_TOKEN" "$encoded"
}
__bt_prompt() {
  local saved_status=$?
  local entry
  entry=$(HISTTIMEFORMAT= builtin history 1)
  if [[ -n "$entry" && "$entry" != "$__bt_previous_history" ]]; then
    __bt_previous_history="$entry"
    local command="${entry#*[0-9]  }"
    local encoded
    encoded=$(printf '%s\0%s\0%s' command "$__bt_previous_cwd" "$command" | base64 | tr -d '\r\n')
    printf '\033]778;BT;%s;%s\007' "$BETTER_TERMINAL_TOKEN" "$encoded"
  fi
  __bt_previous_cwd=$(__bt_cwd)
  __bt_event cwd ''
  __bt_event prompt "$__bt_completion_ready"
  return "$saved_status"
}
if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then
  PROMPT_COMMAND=(__bt_prompt "${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__bt_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
