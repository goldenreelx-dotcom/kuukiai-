// Vercel Serverless Function - Quiz-based Communication Style Diagnosis
// クイズ回答からコミュニケーションスタイルを診断

export default async function handler(req, res) {
  // CORSヘッダー
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
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  const { answers } = req.body;

  if (!answers || !Array.isArray(answers) || answers.length < 5) {
    return res.status(400).json({ error: '診断には5問全ての回答が必要です' });
  }

  const systemPrompt = buildDiagnosePrompt();

  const answersText = answers.map((a, i) =>
    `Q${i + 1}: ${a.question}\nユーザーの回答: ${a.answer}`
  ).join('\n\n');

  let timeoutId;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `以下のクイズ回答から、ユーザーのコミュニケーションスタイルを診断してください:\n\n${answersText}` }]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(503).json({
        error: 'AI診断に失敗しました',
        detail: errorData.error?.message || `HTTP ${response.status}`
      });
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      return res.status(500).json({ error: 'AIからの応答が空です' });
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
      return res.status(500).json({ error: '診断結果のパースに失敗しました' });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return res.status(503).json({ error: 'AI診断がタイムアウトしました。再度お試しください。' });
    }
    console.error('Diagnose error:', error);
    return res.status(500).json({ error: '診断中にエラーが発生しました', detail: error.message });
  }
}

function buildDiagnosePrompt() {
  return `あなたはコミュニケーション心理学の専門家AIです。
ユーザーが空気読みに関するクイズ5問に回答しました。その回答パターンから、ユーザー自身のコミュニケーションスタイルを診断してください。

## 分析のポイント
- 各回答が示すコミュニケーション傾向を読み取る
- 回答パターン全体から総合的にタイプを判定する
- ユーザーが自分で選んだ回答なので、その人の本質的な傾向が表れている

## 8つの診断タイプ（必ずこの中から1つ選んでください）
1. 察し上手タイプ 🔮 - 相手の微妙な感情変化を敏感にキャッチする。空気を読みすぎて疲れることも
2. ストレート派 🎯 - 言葉をそのまま受け取る傾向。裯読みせず効率的だが、婉曲表現を見逃すことも
3. 共感マスター 💕 - 相手の感情に寄り添うのが得意。人間関係の潤滑油だが、自分を後回しにしがち
4. 分析官タイプ 🔍 - 論理的に会話を読み解く。冷静な判断が得意だが、感情面を軽視しがち
5. 調和キーパー ☮️ - 場の空気を穏やかに保つ達人。対立を避けるあまり本音を言えないことも
6. 心配性リーダー 🛡️ - リスクに敏感で先回りして考える。慎重だが、取り越し苦労も多い
7. ポジティブ変換器 ✨ - ネガティブな状況もポジティブに解釈。楽観的だが、問題を見過ごすことも
8. 裏読みマスター 🎭 - 言葉の裏にある真意を見抜く力。洞察力は高いが、考えすぎることも

## 出力形式（必ずこのJSON形式で返してください）
{
  "type": "タイプ名",
  "emoji": "タイプの絶文字（上記の対応する絶文字）",
  "title": "キャッチーな二つ名（例: '心の翻訳者'、'感情の探偵'など）",
  "description": "このタイプの特徴説明（2-3文、親しみやすいトーンで）",
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["あるある弱み1", "あるある弱み2"],
  "compatibility": "相性の良いタイプ名",
  "advice": "このタイプへのアドバイス（1文、ポジティブに）",
  "stats": {
    "察し力": 0-100の数値,
    "共感力": 0-100の数値,
    "分析力": 0-100の数値,
    "表現力": 0-100の数値,
    "調和力": 0-100の数値
  }
}

ユーザーがSNSでシェアしたくなるような、ポジティブで面白い診断結果にしてください。
弱みも「あるある」感があって笑えるような表現にしてください。JSONのみを返してください。`;
}
