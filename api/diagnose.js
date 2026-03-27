// Vercel Serverless Function - Communication Style Diagnosis
// ã¦ã¼ã¶ã¼ã®åæå±¥æ­´ããã³ãã¥ãã±ã¼ã·ã§ã³ã¹ã¿ã¤ã«ãè¨ºæ­

export default async function handler(req, res) {
  // CORSãããã¼
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIã­ã¼ãè¨­å®ããã¦ãã¾ãã' });
  }

  const { history } = req.body;

  if (!history || !Array.isArray(history) || history.length < 5) {
    return res.status(400).json({ error: 'è¨ºæ­ã«ã¯æä½5åã®åæå±¥æ­´ãå¿è¦ã§ã' });
  }

  const systemPrompt = buildDiagnosePrompt();

  // å±¥æ­´ãã¼ã¿ãè¦ç´ãã¦ãã­ã³ããã«æ¸¡ã
  const historyText = history.map((h, i) =>
    `åæ${i + 1}: å¥åã${h.text}ãâ ææ{æã:${h.emotions['æã']}, ä¸æº:${h.emotions['ä¸æº']}, æå¾:${h.emotions['æå¾']}, å¥½æ:${h.emotions['å¥½æ']}, ä¸å®:${h.emotions['ä¸å®']}}, æ¬èªã¬ãã«:${h.keigo}, é¸ãã è¿ä¿¡ãã¼ã³:${h.chosenTone || 'æªé¸æ'}`
  ).join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `ä»¥ä¸ã®ã¦ã¼ã¶ã¼ã®åæå±¥æ­´ãããã³ãã¥ãã±ã¼ã·ã§ã³ã¹ã¿ã¤ã«ãè¨ºæ­ãã¦ãã ãã:\n\n${historyText}` }]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(503).json({ error: 'AIè¨ºæ­ã«å¤±æãã¾ãã', detail: errorData.error?.message || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;

    if (!parts || parts.length === 0) {
      return res.status(500).json({ error: 'AIããã®å¿ç­ãç©ºã§ã' });
    }

    let content = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        content = part.text;
        break;
      }
    }
    if (!content) {
      for (const part of parts) {
        if (part.text) content = part.text;
      }
    }

    try {
      return res.status(200).json(JSON.parse(content));
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return res.status(200).json(JSON.parse(jsonMatch[0]));
      }
      return res.status(500).json({ error: 'è¨ºæ­çµæã®ãã¼ã¹ã«å¤±æãã¾ãã' });
    }
  } catch (error) {
    console.error('Diagnose error:', error);
    return res.status(500).json({ error: 'è¨ºæ­ä¸­ã«ã¨ã©ã¼ãçºçãã¾ãã', detail: error.message });
  }
}

function buildDiagnosePrompt() {
  return `ããªãã¯ã³ãã¥ãã±ã¼ã·ã§ã³å¿çå­¦ã®å°éå®¶AIã§ãã
ã¦ã¼ã¶ã¼ãKuukiAIï¼ç©ºæ°èª­ã¿AIï¼ã§åæãããã­ã¹ãã®å±¥æ­´ãã¿ã¼ã³ããããã®ã¦ã¼ã¶ã¼èªèº«ã®ã³ãã¥ãã±ã¼ã·ã§ã³ã¹ã¿ã¤ã«ãè¨ºæ­ãã¾ãã

## åæããè¦³ç¹
- ã¦ã¼ã¶ã¼ãæ°ã«ããã¡ãªã¡ãã»ã¼ã¸ã®å¾åï¼ãã¬ãã£ãå¯ãï¼ãã¸ãã£ãå¯ãï¼ï¼
- æ¬èªã¬ãã«ã®å¾åï¼ã«ã¸ã¥ã¢ã«ï½ãã©ã¼ãã«ï¼
- ææãã¿ã¼ã³ã®åãï¼æãã«ææï¼ä¸å®ã«ææï¼ï¼
- é¸ã¶è¿ä¿¡ãã¼ã³ã®å¾å
- å¨ä½çãªã³ãã¥ãã±ã¼ã·ã§ã³ã®ç¹å¾´

## 8ã¤ã®è¨ºæ­ã¿ã¤ãï¼å¿ããã®ä¸­ãã1ã¤é¸ãã§ãã ããï¼
1. å¯ãä¸æã¿ã¤ã ð® - ç¸æã®å¾®å¦ãªææå¤åãææã«ã­ã£ãããããç©ºæ°ãèª­ã¿ããã¦ç²ãããã¨ã
2. ã¹ãã¬ã¼ãæ´¾ ð¯ - è¨èããã®ã¾ã¾åãåãå¾åãè£èª­ã¿ããå¹ççã ããå©æ²è¡¨ç¾ãè¦éããã¨ã
3. å±æãã¹ã¿ã¼ ð - ç¸æã®ææã«å¯ãæ·»ãã®ãå¾æãäººéé¢ä¿ã®æ½¤æ»æ²¶ã ããèªåãå¾åãã«ããã¡
4. åæå®ã¿ã¤ã ð - è«ççã«ä¼è©±ãèª­ã¿è§£ããå·éãªå¤æ­ãå¾æã ããææé¢ãè»½è¦ããã¡
5. èª¿åã­ã¼ãã¼ â®ï¸ - å ´ã®ç©ºæ°ãç©ããã«ä¿ã¤éäººãå¯¾ç«ãé¿ãããã¾ãæ¬é³ãè¨ããªããã¨ã
6. å¿éæ§ãªã¼ãã¼ ð¡ï¸ - ãªã¹ã¯ã«ææã§ååããã¦èãããæéã ããåãè¶ãè¦å´ãå¤ã
7. ãã¸ãã£ãå¤æå¨ â¨ - ãã¬ãã£ããªç¶æ³ããã¸ãã£ãã«è§£éãæ¥½è¦³çã ããåé¡ãè¦éãããã¨ã
8. è£èª­ã¿ãã¹ã¿ã¼ ð­ - è¨èã®è£ã«ããçæãè¦æãåãæ´å¯åã¯é«ãããèãããããã¨ã

## åºåå½¢å¼ï¼å¿ããã®JSONå½¢å¼ã§è¿ãã¦ãã ããï¼
{
  "type": "ã¿ã¤ãå",
  "emoji": "ã¿ã¤ãã®çµµæå­ï¼ä¸è¨ã®å¯¾å¿ããçµµæå­ï¼",
  "title": "ã­ã£ããã¼ãªäºã¤åï¼ä¾: 'å¿ã®ç¿»è¨³è'ã'ææã®æ¢åµ'ãªã©ï¼",
  "description": "ãã®ã¿ã¤ãã®ç¹å¾´èª¬æï¼2-3æãè¦ªãã¿ããããã¼ã³ã§ï¼",
  "strengths": ["å¼·ã¿1", "å¼·ã¿2", "å¼·ã¿3"],
  "weaknesses": ["å¼±ã¿1", "å¼±ã¿2"],
  "compatibility": "ç¸æ§ã®è¯ãã¿ã¤ãå",
  "advice": "ãã®ã¿ã¤ãã¸ã®ã¢ããã¤ã¹ï¼1æããã¸ãã£ãã«ï¼",
  "stats": {
    "å¯ãå": 0-100ã®æ°å¤,
    "å±æå": 0-100ã®æ°å¤,
    "åæå": 0-100ã®æ°å¤,
    "è¡¨ç¾å": 0-100ã®æ°å¤,
    "èª¿åå": 0-100ã®æ°å¤
  }
}

ã¦ã¼ã¶ã¼ãSNSã§ã·ã§ã¢ããããªããããªããã¸ãã£ãã§é¢ç½ãè¨ºæ­çµæã«ãã¦ãã ããã
å¼±ã¿ãããããããæããã£ã¦ç¬ãããããªè¡¨ç¾ã«ãã¦ãã ããã
JSONã®ã¿ãè¿ãã¦ãã ããã`;
}
