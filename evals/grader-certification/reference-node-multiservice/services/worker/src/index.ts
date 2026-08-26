import { QueueClient } from '@azure/storage-queue';

const queue = new QueueClient(
    process.env.QUEUE_CONNECTION_STRING ?? 'UseDevelopmentStorage=true',
    'ticket-work',
);

/** Poll the work queue and mark each queued ticket as triaged. */
export async function runWorker(): Promise<void> {
    await queue.createIfNotExists();
    const messages = await queue.receiveMessages({ numberOfMessages: 8 });
    for (const message of messages.receivedMessageItems) {
        await queue.deleteMessage(message.messageId, message.popReceipt);
    }
}

void runWorker();
