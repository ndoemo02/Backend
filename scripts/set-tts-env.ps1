$vars = @{
  "TTS_USE_VERTEX"   = "false"
  "TTS_SIMPLE"       = "true"
  "TTS_CACHE_ENABLED"= "true"
  "TTS_STREAMING"    = "false"
  "TTS_LINEAR16"     = "false"
  "TTS_DEFAULT_VOICE"= "pl-PL-Wavenet-D"
  "TTS_TONE"         = "swobodny"
  # Vertex/Gemini explicit project/location to avoid SDK auto-detection issues
  "GOOGLE_PROJECT_ID" = "freeflow-voiceorder"
  "GEMINI_TTS_LOCATION" = "us-central1"
}

foreach ($k in $vars.Keys) {
  Write-Host "Adding $k = $($vars[$k]) ..." -ForegroundColor Cyan
  vercel env add $k $vars[$k] --yes 2>$null
}

Write-Host ""
Write-Host "✅ All TTS variables added successfully." -ForegroundColor Green
Write-Host "🔁 Syncing with .env.vercel..." -ForegroundColor Yellow
vercel env pull .env.vercel
Write-Host "🔥 Done. You can now run: npm run dev" -ForegroundColor Green
