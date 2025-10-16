const express = require('express');
const WebSocket = require('ws');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

// TTS using ElevenLabs
async function elevenLabsTTS(text) {
  return new Promise((resolve, reject) => {
    const voiceId = process.env.ELEVEN_VOICE_ID;
    const apiKey = process.env.ELEVEN_KEY;
    
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=0`, {
      headers: { 'xi-api-key': apiKey }
    });

    const chunks = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v3',
        voice_settings: { stability: 0.3, similarity_boost: 0.85 }
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.audio) chunks.push(Buffer.from(msg.audio, 'base64'));
      if (msg.isFinal) {
        ws.close();
        resolve(Buffer.concat(chunks));
      }
    });

    ws.on('error', reject);
  });
}

// STT using Deepgram
async function deepgramSTT(audioBuffer) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://api.deepgram.com/v1/listen?language=ar&punctuate=true', {
      headers: { 'Authorization': `Token ${process.env.DEEPGRAM_KEY}` }
    });

    let transcript = '';

    ws.on('open', () => {
      ws.send(audioBuffer);
    });

    ws.on('message', (data) => {
      const result = JSON.parse(data.toString());
      if (result.channel?.alternatives?.[0]?.transcript) {
        transcript = result.channel.alternatives[0].transcript;
      }
      if (result.channel?.is_final) {
        ws.close();
        resolve(transcript);
      }
    });

    ws.on('error', reject);
  });
}

// Twilio webhook
app.post('/twilio', async (req, res) => {
  const response = new twilio.twiml.VoiceResponse();
  
  // First greeting
  if (!req.body.SpeechResult) {
    const audio = await elevenLabsTTS('سلام، معاك شاتسايت. كيفاش نقدر نعاونك؟');
    response.play(audio.toString('base64'));
    response.gather({
      input: 'speech',
      language: 'ar-MA',
      action: '/twilio'
    });
  } else {
    // User spoke something
    const userInput = req.body.SpeechResult;
    
    // Send to OpenAI GPT
    const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'أنت مساعد محترف من شاتسايت. تكلم الدارجة المغربية دائماً. هدفك هو معرفة معلومات العميل وإقناعه بخدماتنا الرقمية. كن لبقاً ومختصراً.'
          },
          {
            role: 'user',
            content: userInput
          }
        ]
      })
    });
    
    const gptData = await gptResponse.json();
    const aiReply = gptData.choices[0].message.content;
    
    // Convert reply to speech
    const audio = await elevenLabsTTS(aiReply);
    response.play(audio.toString('base64'));
    
    // Continue conversation
    response.gather({
      input: 'speech',
      language: 'ar-MA',
      action: '/twilio'
    });
  }
  
  res.type('text/xml');
  res.send(response.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
