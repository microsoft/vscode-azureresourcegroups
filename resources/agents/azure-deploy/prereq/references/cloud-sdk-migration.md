# Non-Azure Cloud Service Dependencies

> Step 2 manifest scan detects these. instructions.md Step 2 handles the `ask_user` redirect gate; this file defines classification.

Functional cloud SDK deps are 🔶 `CLOUD_SDK_MIGRATION`. Fill `prereq-output.json.cloudSdkFindings[]`.

| Found Dependency | Azure Equivalent |
|-----------------|-----------------|
| AWS DynamoDB (`AWSSDK.DynamoDBv2`, `@aws-sdk/client-dynamodb`), GCP Firestore | Cosmos DB (NoSQL API) |
| AWS Cognito (`AWSSDK.CognitoIdentityProvider`, `amazon-cognito-identity-js`), Firebase auth (`firebase-admin`) | Entra ID / Entra External ID |
| AWS S3, GCP Cloud Storage (`@google-cloud/storage`), MinIO | Azure Blob Storage |
| AWS Lambda, GCP Cloud Functions (handler signatures) | Azure Functions (rewrite handlers) |
| AWS SQS (`@aws-sdk/client-sqs`, `AWSSDK.SQS`), GCP Cloud Tasks (`google-cloud-tasks`) | Queue Storage / Service Bus |
| AWS SNS (`@aws-sdk/client-sns`, `AWSSDK.SimpleNotificationService`), GCP Pub/Sub (`google-cloud-pubsub`) | Service Bus / Event Grid |
| Firebase (`firebase`, `firebase-admin`) full stack | Entra ID + Cosmos DB + Functions |

> **Observability carve-out:** Observability deps are ⚠️ WARN (app runs without them), NOT 🔶. Classify by this table:
>
> | Package | Classification | Why |
> |---------|---------------|-----|
> | `@google-cloud/opentelemetry-*` | ⚠️ WARN | Telemetry — app runs without it |
> | `@google-cloud/logging` | ⚠️ WARN | Logging — app runs without it |
> | `@google-cloud/monitoring` | ⚠️ WARN | Monitoring — app runs without it |
> | `aws-xray-sdk`, `aws-rum-web` | ⚠️ WARN | Tracing/RUM — app runs without it |
> | `google-cloud-tasks` | 🔶 CLOUD_SDK_MIGRATION | Functional — required to run |
> | `google-cloud-pubsub` | 🔶 CLOUD_SDK_MIGRATION | Functional — required to run |
> | `google-cloud-storage` | 🔶 CLOUD_SDK_MIGRATION | Functional — required to run |
> | `@aws-sdk/client-dynamodb`, `boto3` (DynamoDB) | 🔶 CLOUD_SDK_MIGRATION | Functional — required to run |
> | `@aws-sdk/client-sqs`, `@aws-sdk/client-sns` | 🔶 CLOUD_SDK_MIGRATION | Functional — required to run |
