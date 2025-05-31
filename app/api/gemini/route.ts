import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';

// Initialize the Gemini API
const genAI = new GoogleGenerativeAI(process.env.NEXT_GEMINI_API_KEY || '');

const SYSTEM_PROMPT = `You are an expert AI Twitter copywriter and creative assistant.

Your role is to help users craft highly engaging, concise, and personalized tweets (under 280 characters) based on detailed input. You must interpret and use all available context to create a compelling tweet aligned with the user's objectives and audience preferences.

Key Requirements:
1. Keep tweets under 280 characters
2. Use the provided tone and style
3. Target the specified audience
4. Make it engaging and shareable
5. Avoid sensitive or controversial content
6. Use emojis sparingly and appropriately

Return ONLY the tweet text, no explanations or additional text.`;

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, tone, goal, audience, conversationHistory } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Create a context-aware prompt
    let enhancedPrompt = `${SYSTEM_PROMPT}\n\nCreate a tweet with the following specifications:\n`;
    
    if (tone) {
      enhancedPrompt += `Tone: ${tone}\n`;
    }
    if (goal) {
      enhancedPrompt += `Goal: ${goal}\n`;
    }
    if (audience) {
      enhancedPrompt += `Target Audience: ${audience}\n`;
    }

    // Add conversation history if available
    if (conversationHistory && conversationHistory.length > 0) {
      enhancedPrompt += '\nPrevious conversation context:\n';
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        enhancedPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
    }

    enhancedPrompt += `\nUser's request: ${prompt}\n\nGenerate a tweet that matches these specifications.`;

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await model.generateContentStream(enhancedPrompt);
          
          for await (const chunk of result.stream) {
            const text = chunk.text();
            controller.enqueue(encoder.encode(text));
          }
          controller.close();
        } catch (error) {
          console.error('Error in stream:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    );
  }
} 