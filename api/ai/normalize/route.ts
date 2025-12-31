import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

export const config = {
    runtime: 'edge', // Using Edge for lower latency
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS(req: Request) {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
    try {
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        const { text } = await req.json();

        if (!text) {
            return new Response(JSON.stringify({ error: 'Missing text' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const { text: normalizedText } = await generateText({
            model: google('gemini-1.5-flash'),
            prompt: `Normalize the following text by fixing typos and grammar, keeping the original meaning and language: "${text}"`,
        });

        return new Response(JSON.stringify({ normalized: normalizedText }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}
