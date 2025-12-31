import { google } from '@ai-sdk/google';
import { streamText } from 'ai';

export const config = {
    runtime: 'edge',
};

export async function POST(req: Request) {
    try {
        const { messages } = await req.json();

        const result = await streamText({
            model: google('gemini-1.5-flash'),
            messages,
            system: 'You are a helpful assistant for FreeFlow system.',
        });

        return result.toTextStreamResponse();
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
