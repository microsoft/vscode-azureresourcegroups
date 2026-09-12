# Scrapbook Project (Test Fixture)

A shared photo scrapbook app where two paired users share special moments through
photos with AI-generated labels. Includes a timer-triggered background worker that
cleans up old photos from the database and blob storage based on a retention policy.

- **Backend:** TypeScript Azure Functions API (`scrapbook-api`)
- **Frontend:** React + Vite web app (`scrapbook-web`)
<!-- A bit of a contrived example, but wanted to see how it handeled adding a third service -->
- **Worker:** TypeScript timer-triggered cleanup worker (`cleanup-worker`)
- **Data stores:** PostgreSQL + Blob Storage
- **Auth:** Mock auth middleware

## Model

- Claude Opus 4.6
