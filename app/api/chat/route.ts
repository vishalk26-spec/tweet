import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { currentUser } from '@clerk/nextjs/server'

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, chatId, chatData } = await req.json();

    switch (action) {
      case 'save':
        const key = `${user.id}/chats/${chatId}/data.json`;
        const command = new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: key,
          Body: JSON.stringify(chatData),
          ContentType: 'application/json',
        });
        await s3Client.send(command);
        return NextResponse.json({ success: true });

      case 'get':
        const getKey = `${user.id}/chats/${chatId}/data.json`;
        const getCommand = new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: getKey,
        });
        const response = await s3Client.send(getCommand);
        const data = await response.Body?.transformToString();
        return NextResponse.json({ data: data ? JSON.parse(data) : null });

      case 'list':
        const prefix = `${user.id}/chats/`;
        const listCommand = new ListObjectsV2Command({
          Bucket: process.env.S3_BUCKET_NAME!,
          Prefix: prefix,
          Delimiter: '/',
        });
        const listResponse = await s3Client.send(listCommand);
        const chatIds = listResponse.CommonPrefixes?.map(prefix => 
          prefix.Prefix?.split('/')[2] || ''
        ).filter(Boolean) || [];
        return NextResponse.json({ chatIds });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 