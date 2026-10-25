#!/usr/bin/env bash
# Vercel Ignored Build Step: exit 1 builds, exit 0 skips.
# Build production deployments only; skip previews.
if [ "${VERCEL_ENV:-}" = "production" ]; then
	echo "Production deployment: building."
	exit 1
fi
echo "Skipping build for VERCEL_ENV=${VERCEL_ENV:-unset}."
exit 0
