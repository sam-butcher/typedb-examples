import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page queries TypeDB per request (force-dynamic), so no incremental cache is configured.
export default defineCloudflareConfig({});
