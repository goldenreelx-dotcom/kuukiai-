export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { selections } = req.body;
  if (!selections || !Array.isArray(selections) || selections.length < 5) {
    return res.status(400).json({ error: '診断には5回以上の返信選択が必要です' });
  }

  const selectionsText = selections.map((s, i) =>
    `選択${i + 1}: トーン「${s.tone}」 - 返信「${s.text}」`
  ).join('\n');

  const prompt = `あなたはコミュニケーションタイプ診断の専門家です。
ユーザーがメッセージの「空気読み」分析結果から選んだ「おすすめの返信」のパターンを分析してください。

選択された返信:
${selectionsText}

上記の選択パターンから、ユーザーのコミュニケーションタイプを以下の8タイプの中から1つ選んでください:
1. 裏読みマスター - 言葉の裏側を鋭く読み取る
2. ストレート派 - 素直で明快なコミュニケーション
3. 共感マスター - 相手の気持ちに対する共感力が高い
4. バランス型 - 状況に応じて柔軟に対応
5. 慎重派 - 全体像を把握してから判断
6. ムードメーカー - 場の空気を明るくする
7. サポーター気質 - 相手を優先して支える
8. リアリスト - 事実ベースで冷静に判断

以下のJSON形式で回答してください:
{
  "type": "タイプ名",
  "emoji": "代表絵文字",
  "title": "キャッチコピー（10字以内）",
  "description": "説明文（50-100字）",
  "stats": {"察し力": 0-100, "共感力": 0-100, "分析力": 0-100, "表現力": 0-100, "調和力": 0-100},
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["あるある1", "あるある2", "あるある3"],
  "compatibility": "相性の良いタイプ名",
  "advice": "アドバイス（30-50字）"
}

JSONのみを出力してください。必ず選択パターンを反映させてください。`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    });

    clearTimeout(timeoutId);
    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Gemini API error', detail: err });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'Empty response from AI' });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Invalid JSON response' });

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: '診断がタイムアウトしました' });
    }
    return res.status(500).json({ error: '診断に失敗しました', detail: error.message });
  }
}
