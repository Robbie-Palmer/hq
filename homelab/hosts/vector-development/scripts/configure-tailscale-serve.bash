if ! tailscale status --json | jq --exit-status '.BackendState == "Running"' >/dev/null; then
  echo "Tailscale is not enrolled; Serve will be configured after enrollment"
  exit 0
fi

tailscale serve reset
tailscale serve --bg --https=443 http://127.0.0.1:30773
for offset in 0 1 2 3 4; do
  port=$((3000 + offset))
  node_port=$((31000 + offset))
  tailscale serve --bg --https="${port}" "http://127.0.0.1:${node_port}"
done
