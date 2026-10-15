#!/bin/sh
# Hosts mount the data disk at /data owned by root (e.g. Render). Give it to the app's user, then run the
# app as that user, never as root. Already running as a normal user: just start.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R sellerdoos:sellerdoos /data
  exec setpriv --reuid=sellerdoos --regid=sellerdoos --init-groups node server.js
fi
exec node server.js
