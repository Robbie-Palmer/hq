set -euo pipefail

request=
attempts=0
while ((attempts < 60)); do
  for candidate in /run/systemd/ask-password/ask.*; do
    [[ -f ${candidate} ]] || continue
    request_id=
    while IFS='=' read -r field value; do
      if [[ ${field} == Id ]]; then
        request_id=${value}
        break
      fi
    done <"${candidate}"
    case ${request_id} in
      cryptsetup:*)
        if [[ -n ${request} ]]; then
          echo "more than one LUKS password request is pending" >&2
          exit 1
        fi
        request=${candidate}
        ;;
    esac
  done
  [[ -z ${request} ]] || break
  attempts=$((attempts + 1))
  sleep 1
done

if [[ -z ${request} ]]; then
  echo "the Vector LUKS password request is not available" >&2
  exit 1
fi

socket=
while IFS='=' read -r field value; do
  if [[ ${field} == Socket ]]; then
    socket=${value}
    break
  fi
done <"${request}"
if [[ -z ${socket} || ! -S ${socket} ]]; then
  echo "the Vector LUKS password socket is not available" >&2
  exit 1
fi

exec /bin/systemd-reply-password 1 "${socket}"
