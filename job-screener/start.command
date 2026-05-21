#!/bin/bash
cd "$(dirname "$0")"
sleep 3 && open -a Safari http://localhost:3000 &
npm start
