gcloud beta logging tail \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="mcp-server" AND jsonPayload:*' \
  --format='value(timestamp,jsonPayload)'