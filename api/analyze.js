// Vercel Serverless Function - Gemini API endpoint
// ãã©ã³ã«å¿ãã¦Flash/Pro/Proãä½¿ãåããProã¯æ·±å±¤åæãæä¾

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

  const { text, plan, scene } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'ãã­ã¹ããå¥åãã¦ãã ãã' });
  }

  // ãã©ã³ã«å¿ããã¢ãã«ã®é¸æ
  const modelMap = {
    free: 'gemini-2.5-flash',    // Flashï¼è»½éã»é«éï¼
    premium: 'gemini-2.5-pro',   // Proï¼é«ç²¾åº¦ï¼
    pro: 'gemini-2.5-pro'        // Proï¼æé«ç²¾åº¦ã»æ·±å±¤åæï¼
  };

  const model = modelMap[plan] || modelMap.free;

  // å ´é¢ã«å¿ããã³ã³ãã­ã¹ã
  const sceneContext = {
    'LINEã»ãã£ãã': 'ã«ã¸ã¥ã¢ã«ãªã¡ãã»ã¼ã¸ã¢ããªã§ã®ä¼è©±',
    'ãã¸ãã¹ã¡ã¼ã«': 'ãã¸ãã¹ã·ã¼ã³ã§ã®ãã©ã¼ãã«ãªã¡ã¼ã«',
    'SNSæç¨¿': 'TwitterãInstagramãªã©ã®SNSæç¨¿',
    'ãã®ä»': 'ä¸è¬çãªãã­ã¹ãã³ãã¥ãã±ã¼ã·ã§ã³'
  };

  const sceneDesc = sceneContext[scene] || sceneContext['ãã®ä»'];

  // ãã©ã³ã«å¿ããã·ã¹ãã ãã­ã³ãã
  const systemPrompt = plan === 'pro' ? buildProPrompt(sceneDesc) : buildStandardPrompt(sceneDesc);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `ä»¥ä¸ã®ã¡ãã»ã¼ã¸ã®ãç©ºæ°ããèª­ãã§ãã ãã:\n\nã${text}ã` }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Gemini API error:', response.status, errorData);
      return res.status(response.status).json({
        error: 'AIåæã«å¤±æãã¾ãã',
        detail: errorData.error?.message || 'Unknown error'
      });
    }

    const data = await response.json();

    // gemini-2.5-flash ã¯ "thinking model" ã®ãããparts ã«
    // thought ãã¼ãã¨ text ãã¼ããæ··å¨ããå ´åããã
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      console.error('No parts in response:', JSON.stringify(data).substring(0, 500));
      throw new Error('AIããã®å¿ç­ãç©ºã§ã');
    }

    // text ãã¼ããæ¢ãï¼thought ã§ãªããã¼ãï¼
    let content = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        content = part.text;
        break;
      }
    }
    // thought ãããªãå ´åã¯æå¾ã® text ãä½¿ã
    if (!content) {
      for (const part of parts) {
        if (part.text) {
          content = part.text;
        }
      }
    }

    if (!content) {
      console.error('No text content in parts:', JSON.stringify(parts).substring(0, 500));
      throw new Error('AIã®å¿ç­ã«ãã­ã¹ããå«ã¾ãã¦ãã¾ãã');
    }

    // JSONãæ½åº
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        console.error('Failed to parse JSON from content:', content.substring(0, 300));
        throw new Error('AIã®å¿ç­ããã¼ã¹ã§ãã¾ããã§ãã');
      }
    }

    // ã¬ã¹ãã³ã¹ã«ã¢ãã«æå ±ãè¿½å 
    result._model = model;
    result._plan = plan;

    return res.status(200).json(result);

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({
      error: 'åæä¸­ã«ã¨ã©ã¼ãçºçãã¾ãã',
      detail: error.message
    });
  }
}

// Free / Premium ç¨ã®æ¨æºãã­ã³ãã
function buildStandardPrompt(sceneDesc) {
  return `ããªãã¯æ¥æ¬èªã³ãã¥ãã±ã¼ã·ã§ã³ã®ãç©ºæ°ãèª­ããå°éå®¶AIã§ãã
ç¸æã®ã¡ãã»ã¼ã¸ãããè¡¨é¢çãªæå³ã ãã§ãªããæ¬é³ãããé ãããææããåæãã¾ãã

## ã³ã³ãã­ã¹ã
ããã¯ã${sceneDesc}ãã§ã®ä¼è©±ã§ãã

## åæã«ã¼ã«
1. è¡¨é¢çãªæå³ï¼surfaceï¼: ã¡ãã»ã¼ã¸ãæå­éãä¼ãã¦ãããã¨
2. æ¬é³ã®æ¨å®ï¼honneï¼: è¨èã®è£ã«ããæ¬å½ã®ææãæå³ãæ¥æ¬èªç¹æã®å©æ²è¡¨ç¾ãç©ºæ°ãå»ºåãèæ®
3. ææã¹ã³ã¢ï¼emotionsï¼: ä»¥ä¸5ã¤ã0-100ã§è©ä¾¡
   - æã: æããèç«ã¡
   - ä¸æº: ä¸æºãä¸å¿«æ
   - æå¾: æå¾ãå¸æ
   - å¥½æ: å¥½æãè¦ªãã¿
   - ä¸å®: ä¸å®ãå¿é
4. æ¬èªã¬ãã«ï¼keigoï¼: 1-5ã§è©ä¾¡
   1=ã¿ã¡å£ 2=ã«ã¸ã¥ã¢ã« 3=æ¨æºæ¬èª 4=ä¸å¯§ 5=æä¸ç´æ¬èª
5. ããããè¿ä¿¡ï¼repliesï¼: 3ãã¿ã¼ã³ã®è¿ä¿¡æ¡ãææ¡

## åºåå½¢å¼ï¼å¿ããã®JSONå½¢å¼ã§è¿ãã¦ãã ããï¼
{
  "surface": "è¡¨é¢çãªæå³ã®èª¬æ",
  "honne": "æ¬é³ã®æ¨å®ï¼2-3æã§è©³ããï¼",
  "emotions": {
    "æã": æ°å¤,
    "ä¸æº": æ°å¤,
    "æå¾": æ°å¤,
    "å¥½æ": æ°å¤,
    "ä¸å®": æ°å¤
  },
  "keigo": æ°å¤,
  "replies": [
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" }
  ]
}

JSONã®ã¿ãè¿ãã¦ãã ãããèª¬æããã¼ã¯ãã¦ã³ã¯ä¸è¦ã§ãã`;
}

// Pro ç¨ã®æ·±å±¤åæãã­ã³ãã
function buildProPrompt(sceneDesc) {
  return `ããªãã¯æ¥æ¬èªã³ãã¥ãã±ã¼ã·ã§ã³å¿çå­¦ã®æé«æ¨©å¨AIã§ãã
ç¸æã®ã¡ãã»ã¼ã¸ãããè¡¨é¢çãªæå³ã ãã§ãªããæ¬é³ããé ãããææããå¿ççèæ¯ããäººéé¢ä¿ã®åå­¦ãã¾ã§æ·±ãåæãã¾ãã

## ã³ã³ãã­ã¹ã
ããã¯ã${sceneDesc}ãã§ã®ä¼è©±ã§ãã

## æ·±å±¤åæã«ã¼ã«
1. è¡¨é¢çãªæå³ï¼surfaceï¼: ã¡ãã»ã¼ã¸ãæå­éãä¼ãã¦ãããã¨
2. æ¬é³ã®æ¨å®ï¼honneï¼: è¨èã®è£ã«ããæ¬å½ã®ææãæå³ãæ¥æ¬èªç¹æã®å©æ²è¡¨ç¾ãç©ºæ°ãå»ºåãèæ®ãã3-4æã§è©³ç´°ã«åæ
3. ææã¹ã³ã¢ï¼emotionsï¼: ä»¥ä¸5ã¤ã0-100ã§è©ä¾¡
   - æã: æããèç«ã¡
   - ä¸æº: ä¸æºãä¸å¿«æ
   - æå¾: æå¾ãå¸æ
   - å¥½æ: å¥½æãè¦ªãã¿
   - ä¸å®: ä¸å®ãå¿é
4. æ¬èªã¬ãã«ï¼keigoï¼: 1-5ã§è©ä¾¡
   1=ã¿ã¡å£ 2=ã«ã¸ã¥ã¢ã« 3=æ¨æºæ¬èª 4=ä¸å¯§ 5=æä¸ç´æ¬èª
5. ããããè¿ä¿¡ï¼repliesï¼: 5ãã¿ã¼ã³ã®è¿ä¿¡æ¡ãææ¡ï¼å¤æ§ãªã¢ãã­ã¼ãã§ï¼
6. å¿ççèæ¯ï¼psychologyï¼: ãã®çºè¨ã®è£ã«ããå¿çã¡ã«ããºã ãåæãé²è¡æ©å¶ãèªç¥ãã¤ã¢ã¹ãã¢ã¿ããã¡ã³ãã¹ã¿ã¤ã«ãªã©ã®å¿çå­¦çè¦³ç¹ãã2-3æã§è§£èª¬
7. äººéé¢ä¿ã®åå­¦ï¼dynamicsï¼: çºè¨èã¨ç¸æã®é¢ä¿æ§ã«ãããä¸ä¸é¢ä¿ãè·é¢æããã¯ã¼ãã©ã³ã¹ãåæã1-2æã§è§£èª¬
8. å±éºåº¦ã·ã°ãã«ï¼riskSignalï¼: ãã®ä¼è©±ã«ãããé¢ä¿æªåãªã¹ã¯ãè©ä¾¡
   - level: "safe" | "caution" | "warning" ã®3æ®µé
   - message: ãªã¹ã¯ã®èª¬æï¼1æï¼
9. æåçã³ã³ãã­ã¹ãï¼culturalNoteï¼: ãã®è¡¨ç¾ãæ¥æ¬æåç¹æã®ãç©ºæ°ããå»ºåããå¯ããã¨ã©ãé¢ä¿ãããã1-2æã§è§£èª¬

## åºåå½¢å¼ï¼å¿ããã®JSONå½¢å¼ã§è¿ãã¦ãã ããï¼
{
  "surface": "è¡¨é¢çãªæå³ã®èª¬æ",
  "honne": "æ¬é³ã®æ¨å®ï¼3-4æã§è©³ç´°ã«ï¼",
  "emotions": {
    "æã": æ°å¤,
    "ä¸æº": æ°å¤,
    "æå¾": æ°å¤,
    "å¥½æ": æ°å¤,
    "ä¸å®": æ°å¤
  },
  "keigo": æ°å¤,
  "replies": [
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" },
    { "tone": "ãã¼ã³ã®åå", "text": "è¿ä¿¡æ" }
  ],
  "psychology": "å¿ççèæ¯ã®åæ",
  "dynamics": "äººéé¢ä¿ã®åå­¦ã®åæ",
  "riskSignal": {
    "level": "safe ã¾ãã¯ caution ã¾ãã¯ warning",
    "message": "ãªã¹ã¯ã®èª¬æ"
  },
  "culturalNote": "æåçã³ã³ãã­ã¹ãã®è§£èª¬"
}

JSONã®ã¿ãè¿ãã¦ãã ãããèª¬æããã¼ã¯ãã¦ã³ã¯ä¸è¦ã§ãã`;
}
