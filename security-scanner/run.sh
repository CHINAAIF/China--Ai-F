#!/usr/bin/env bash
cd ~/downloads/China--Ai-F
node security-scanner/scan.js 2>&1 | tee -a security-scanner/scan-history.log
