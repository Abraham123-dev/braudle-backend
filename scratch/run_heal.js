import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import GeneralChatSession from '../src/models/GeneralChatSession.model.js';
import * as AIService from '../src/services/ai.service.js';
import { parseAIJson } from '../src/utils/parseAIJson.js';

async function healDb() {
  await connectDB();
  try {
    const sessions = await GeneralChatSession.find({
      "imageKnowledge.analysis.summary": ""
    });

    console.log(`Found ${sessions.length} sessions containing empty analysis records.`);

    for (const session of sessions) {
      console.log(`Processing Session: ${session._id}`);
      let wasHealed = false;

      for (let img of session.imageKnowledge) {
        if (!img.analysis.summary) {
          console.log(`Healing: ${img.fileName} (Hash: ${img.imageHash})`);
          
          const imageRes = await fetch(img.fileUrl);
          if (!imageRes.ok) {
            console.error(`Failed to fetch image: ${imageRes.status}`);
            continue;
          }
          const arrayBuffer = await imageRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          let mimetype = 'image/png';
          if (img.fileUrl.endsWith('.jpg') || img.fileUrl.endsWith('.jpeg')) mimetype = 'image/jpeg';
          else if (img.fileUrl.endsWith('.webp')) mimetype = 'image/webp';

          const base64 = buffer.toString('base64');
          const visionMessages = [
            {
              role: 'system',
              content: `You are an advanced academic vision intelligence model. Analyze the provided image thoroughly and output your analysis in raw JSON format matching this schema:
{
  "extractedText": "exact text from handwritten notes, slides, screenshots, or equations",
  "summary": "a clear 1-2 sentence summary of what the image shows",
  "questions": ["list of questions detected in the image, transcribed exactly"],
  "equations": ["list of math/science equations transcribed in LaTeX format"],
  "diagrams": ["descriptions of any graphs, charts, diagrams, or visual layouts"],
  "keyConcepts": ["list of key academic concepts mentioned or shown"],
  "detectedTopics": ["list of broad educational topics/subject areas"]
}
Do not wrap in markdown backticks or add any conversational filler. Return only valid raw JSON.`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this image and return the structured JSON analysis.',
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimetype};base64,${base64}` },
                },
              ],
            }
          ];

          const visionResponseText = await AIService.generateAIResponse({ task: 'vision', messages: visionMessages });
          
          const defaultAnalysis = {
            extractedText: '',
            summary: '',
            questions: [],
            equations: [],
            diagrams: [],
            keyConcepts: [],
            detectedTopics: []
          };

          const parsedAnalysis = parseAIJson(visionResponseText, defaultAnalysis);
          console.log(`Parsed analysis summary: "${parsedAnalysis.summary}"`);

          const searchText = `${parsedAnalysis.summary || ''} ${(parsedAnalysis.detectedTopics || []).join(' ')} ${(parsedAnalysis.keyConcepts || []).join(' ')} ${(parsedAnalysis.questions || []).join(' ')}`;
          const embeddings = await AIService.generateEmbedding(searchText);

          img.analysis = parsedAnalysis;
          img.embeddings = embeddings;
          wasHealed = true;

          // Update database-wide to heal all other session documents as well
          await GeneralChatSession.updateMany(
            { "imageKnowledge.imageHash": img.imageHash },
            { 
              $set: { 
                "imageKnowledge.$[elem].analysis": parsedAnalysis,
                "imageKnowledge.$[elem].embeddings": embeddings
              }
            },
            { 
              arrayFilters: [{ "elem.imageHash": img.imageHash }] 
            }
          );
        }
      }

      if (wasHealed) {
        session.markModified('imageKnowledge');
        await session.save();
        console.log(`Session ${session._id} saved and healed!`);
      }
    }

  } catch (err) {
    console.error('Healing script error:', err);
  } finally {
    await mongoose.connection.close();
  }
}

healDb();
