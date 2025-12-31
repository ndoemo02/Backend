import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

export const config = {
    runtime: 'edge', // Using Edge for lower latency
};

export async function POST(req: Request) {
    try {
        const { text } = await req.json();

        if (!text) {
            return new Response(JSON.stringify({ error: 'Missing text' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { text: normalizedText } = await generateText({
            model: google('gemini-1.5-flash'),
            prompt: `Normalize the following text by fixing typos and grammar, keeping the original meaning and language: "${text}"`,
        });

        return new Response(JSON.stringify({ normalized: normalizedText }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
