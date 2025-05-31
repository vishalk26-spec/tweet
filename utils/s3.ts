import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface ChatData {
  id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export async function saveChatToS3(userId: string, chatId: string, chatData: ChatData): Promise<void> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'save',
        chatId,
        chatData,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to save chat data');
    }
  } catch (error) {
    console.error('Error saving chat to S3:', error);
    throw new Error('Failed to save chat data');
  }
}

export async function getChatFromS3(userId: string, chatId: string): Promise<ChatData | null> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'get',
        chatId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get chat data');
    }

    const { data } = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting chat from S3:', error);
    return null;
  }
}

export async function listUserChats(userId: string): Promise<string[]> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'list',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to list chats');
    }

    const { chatIds } = await response.json();
    return chatIds;
  } catch (error) {
    console.error('Error listing user chats:', error);
    return [];
  }
} 