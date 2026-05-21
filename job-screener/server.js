require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const Groq = require('groq-sdk');

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static('public'));

// ── FILE PARSE ────────────────────────────────────────
app.post('/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { mimetype, originalname, buffer } = req.file;

  try {
    let text = '';
    if (mimetype === 'application/pdf' || originalname.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      originalname.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (mimetype === 'text/plain' || originalname.endsWith('.txt')) {
      text = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
    }

    text = text.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (!text) return res.status(400).json({ error: 'Could not extract text from this file.' });

    res.json({ text, filename: originalname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'File parsing failed: ' + err.message });
  }
});

// ── SCREEN ────────────────────────────────────────────
const STRICTNESS = {
  1: 'Be lenient. Advance candidates who meet at least 60% of the requirements. Give the benefit of the doubt on ambiguous experience.',
  2: 'Be balanced. Advance candidates who clearly meet approximately 75% of the requirements.',
  3: 'Be strict. Only advance candidates who strongly meet 85% or more of the requirements with clear, specific evidence in their resume.',
};

app.post('/screen', async (req, res) => {
  const { jobDescription, resume, strictness = 2 } = req.body;
  if (!jobDescription?.trim() || !resume?.trim()) {
    return res.status(400).json({ error: 'Both job description and resume are required.' });
  }

  const prompt = `You are an expert hiring assistant. Analyze the resume against the job description and return a structured screening result.

SCREENING STRICTNESS: ${STRICTNESS[strictness] || STRICTNESS[2]}

JOB DESCRIPTION:
${jobDescription}

RESUME:
${resume}

Respond with ONLY valid JSON in this exact format:
{
  "decision": "ADVANCE" or "REJECT",
  "confidence": "High", "Medium", or "Low",
  "resume_score": <0-100 composite score weighted as: skills match 30%, experience relevance 25%, keyword/terminology alignment 15%, education fit 15%, career trajectory 10%, resume professionalism 5%. Be precise and critical.>,
  "summary": "One paragraph (3-4 sentences) the recruiter can paste into their notes.",
  "scores": {
    "skills_match": <0-100>,
    "experience_level": <0-100>,
    "education_fit": <0-100>,
    "overall_fit": <0-100>
  },
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "gaps": ["gap 1", "gap 2", "gap 3"],
  "decision_reason": "One sentence explaining the top reason for this decision."
}`;

  const start = Date.now();
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const result = JSON.parse(completion.choices[0].message.content);
    result.screening_time_seconds = elapsed;
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Screening failed. Check your API key and try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Job Screener running at http://localhost:${PORT}`));
