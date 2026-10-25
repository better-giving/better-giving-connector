#!/usr/bin/env bash
# Vercel Ignored Build Step: exit 1 to build, exit 0 to skip.
# Build production deployments only; skip previews.
env_name="${VERCEL_TARGET_ENV:-${VERCEL_ENV:-}}"
echo "VERCEL_ENV=${VERCEL_ENV:-unset} VERCEL_TARGET_ENV=${VERCEL_TARGET_ENV:-unset}"
if [ "$env_name" = "production" ]; then
	echo "Production deployment: building."
	exit 1
fi
echo "Not production: skipping the build."
exit 0
