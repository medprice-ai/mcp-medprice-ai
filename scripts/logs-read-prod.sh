 gcloud beta logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="mcp-server"' \
  --format=json