// Test TTS integration
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import fs from 'fs';

async function testTts() {
  console.log('🧪 Testing TTS integration...');
  
  try {
    // Initialize TTS client
    let ttsClient;
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      console.log('✅ Using Vercel environment credentials (JSON)');
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      ttsClient = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.log('✅ Using Vercel environment credentials (Base64)');
      const credentialsJson = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
      const credentials = JSON.parse(credentialsJson);
      ttsClient = new TextToSpeechClient({ credentials });
    } else {
      console.log('⚠️ Using local service account');
      ttsClient = new TextToSpeechClient({ 
        keyFilename: './service-account.json'
      });
    }

    // Test text
    const testText = "Witaj w Freeflow! To jest test syntezy mowy w języku polskim.";
    
    // Configure the request
    const request = {
      input: { text: testText },
      voice: {
        languageCode: 'pl-PL',
        name: 'pl-PL-Wavenet-A',
        ssmlGender: 'FEMALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        volumeGainDb: 0.0
      }
    };

    console.log('🔄 Sending to Google Cloud TTS...');
    console.log('📝 Text:', testText);
    console.log('🎤 Voice:', request.voice.name);
    
    // Perform the text-to-speech request
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    // Save audio to file for testing
    const audioContent = response.audioContent;
    fs.writeFileSync('./test-audio.mp3', audioContent, 'binary');
    
    console.log('✅ TTS synthesis completed successfully!');
    console.log('📁 Audio saved to: ./test-audio.mp3');
    console.log('📊 Audio size:', audioContent.length, 'bytes');
    
    // Test different voices
    console.log('\n🎭 Testing different Polish voices...');
    
    const voices = [
      { name: 'pl-PL-Wavenet-A', gender: 'FEMALE' },
      { name: 'pl-PL-Wavenet-B', gender: 'MALE' },
      { name: 'pl-PL-Standard-A', gender: 'FEMALE' },
      { name: 'pl-PL-Standard-B', gender: 'MALE' }
    ];
    
    for (const voice of voices) {
      try {
        const voiceRequest = {
          input: { text: `Głos ${voice.name}` },
          voice: {
            languageCode: 'pl-PL',
            name: voice.name,
            ssmlGender: voice.gender
          },
          audioConfig: {
            audioEncoding: 'MP3'
          }
        };
        
        const [voiceResponse] = await ttsClient.synthesizeSpeech(voiceRequest);
        const filename = `./test-voice-${voice.name.replace('pl-PL-', '')}.mp3`;
        fs.writeFileSync(filename, voiceResponse.audioContent, 'binary');
        console.log(`✅ ${voice.name} (${voice.gender}) - saved to ${filename}`);
      } catch (error) {
        console.error(`❌ Failed to test voice ${voice.name}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ TTS test failed:', error);
    
    if (error.code === 7) {
      console.error('🔑 Permission denied. Check Google Cloud credentials.');
    } else if (error.code === 3) {
      console.error('📝 Invalid argument. Check text content and voice parameters.');
    } else if (error.code === 8) {
      console.error('💰 Resource exhausted. TTS quota exceeded.');
    }
    
    process.exit(1);
  }
}

// Run the test
testTts().then(() => {
  console.log('\n🎉 TTS integration test completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 TTS integration test failed:', error);
  process.exit(1);
});
