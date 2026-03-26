// Vercel Serverless Function - Gemini API endpoint
// プランに応じてFlash/Pro/Proを使い分け、Proは深層分析を提供

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

  const { text, plan, scene } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'テキストを入力してください' });
  }

  // プランに応じたモデルの選択
  const modelMap = {
    free: 'gemini-2.5-flash',    // Flash（軽量・高速）
    premium: 'gemini-2.5-pro',   // Pro（高精度）
    pro: 'gemini-2.5-pro'        // Pro（最高精度・深層分析）
  };

  const model = modelMap[plan] || modelMap.free;

  // 場面に応じたコンテキスト
  const sceneContext = {
    'LINE・チャット': 'カジュアルなメッセージアプリでの会話',
    'ビジネスメール': 'ビジネスシーンでのフォーマルなメール',
    'SNS投稿': 'TwitterやInstagramなどのSNS投稿',
    'その他': '一般的なテキストコミュニケーション'
  };

  const sceneDesc = sceneContext[scene] || sceneContext['その他'];

  // プランに応じたシステムプロンプト
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
            parts: [{ text: `以下のメッセージの「空気」を読んでください:\n\n「${text}」` }]
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
        error: 'AI分析に失敗しました',
        detail: errorData.error?.message || 'Unknown error'
      });
    }

    const data = await response.json();

    // gemini-2.5-flash は "thinking model" のため、parts に
    // thought パートと text パートが混在する場合がある
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      console.error('No parts in response:', JSON.stringify(data).substring(0, 500));
      throw new Error('AIからの応答が空です');
    }

    // text パートを探す（thought でないパート）
    let content = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        content = part.text;
        break;
      }
    }
    // thought しかない場合は最後の text を使う
    if (!content) {
      for (const part of parts) {
        if (part.text) {
          content = part.text;
        }
      }
    }

    if (!content) {
      console.error('No text content in parts:', JSON.stringify(parts).substring(0, 500));
      throw new Error('AIの応答にテキストが含まれていません');
    }

    // JSONを抽出
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        console.error('Failed to parse JSON from content:', content.substring(0, 300));
        throw new Error('AIの応答をパースできませんでした');
      }
    }

    // レスポンスにモデル情報を追加
    result._model = model;
    result._plan = plan;

    return res.status(200).json(result);

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({
      error: '分析中にエラーが発生しました',
      detail: error.message
    });
  }
}

// Free / Premium 用の標準プロンプト
function buildStandardPrompt(sceneDesc) {
  return `あなたは日本語コミュニケーションの「空気を読む」専門家AIです。
相手のメッセージから、表面的な意味だけでなく「本音」や「隠された感情」を分析します。

## コンテキスト
これは「${sceneDesc}」での会話です。

## 分析ルール
1. 表面的な意味（surface）: メッセージが文字通り伝えていること
2. 本音の推定（honne）: 言葉の裏にある本当の感情や意図。日本語特有の婉曲表現、空気、建前を考慮
3. 感情スコア（emotions）: 以下5つを0-100で評価
   - 怒り: 怒りや苛立ち
   - 不満: 不満や不快感
   - 期待: 期待や希望
   - 好意: 好意や親しみ
   - 不安: 不安や心配
4. 敬語レベル（keigo）: 1-5で評価
   1=タメ口 2=カジュアル 3=標準敬語 4=丁寧 5=最上級敬語
5. おすすめ返信（replies）: 3パターンの返信案を提案

## 出力形式（必ずこのJSON形式で返してください）
{
  "surface": "表面的な意味の説明",
  "honne": "本音の推定（2-3文で詳しく）",
  "emotions": {
    "怒り": 数値,
    "不満": 数値,
    "期待": 数値,
    "好意": 数値,
    "不安": 数値
  },
  "keigo": 数値,
  "replies": [
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" }
  ]
}

JSONのみを返してください。説明やマークダウンは不要です。`;
}

// Pro 用の深層分析プロンプト
function buildProPrompt(sceneDesc) {
  return `あなたは日本語コミュニケーション心理学の最高権威AIです。
相手のメッセージから、表面的な意味だけでなく「本音」「隠された感情」「心理的背景」「人間関係の力学」まで深く分析します。

## コンテキスト
これは「${sceneDesc}」での会話です。

## 深層分析ルール
1. 表面的な意味（surface）: メッセージが文字通り伝えていること
2. 本音の推定（honne）: 言葉の裏にある本当の感情や意図。日本語特有の婉曲表現、空気、建前を考慮し、3-4文で詳細に分析
3. 感情スコア（emotions）: 以下5つを0-100で評価
   - 怒り: 怒りや苛立ち
   - 不満: 不満や不快感
   - 期待: 期待や希望
   - 好意: 好意や親しみ
   - 不安: 不安や心配
4. 敬語レベル（keigo）: 1-5で評価
   1=タメ口 2=カジュアル 3=標準敬語 4=丁寧 5=最上級敬語
5. おすすめ返信（replies）: 5パターンの返信案を提案（多様なアプローチで）
6. 心理的背景（psychology）: この発言の裏にある心理メカニズムを分析。防衋機制、認知バイアス、アタッチメントスタイルなどの心理学的観点から2-3文で解説
7. 人間関係の力学（dynamics）: 発言者と相手の関係性における上下関係、距離感、パワーバランスを分析。1-2文で解説
8. 危険度シグナル（riskSignal）: この会話における関係悪化リスクを評価
   - level: "safe" | "caution" | "warning" の3段階
   - message: リスクの説明（1文）
9. 文化的コンテキスト（culturalNote）: この表現が日本文化特有の「空気」「建前」「察し」とどう関係するかを1-2文で解説

## 出力形式（必ずこのJSON形式で返してください）
{
  "surface": "表面的な意味の説明",
  "honne": "本音の推定（3-4文で詳細に）",
  "emotions": {
    "怒り": 数値,
    "不満": 数値,
    "期待": 数値,
    "好意": 数値,
    "不安": 数値
  },
  "keigo": 数値,
  "replies": [
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" },
    { "tone": "トーンの名前", "text": "返信文" }
  ],
  "psychology": "心理的背景の分析",
  "dynamics": "人間関係の力学の分析",
  "riskSignal": {
    "level": "safe または caution または warning",
    "message": "リスクの説明"
  },
  "culturalNote": "文化的コンテキストの解説"
}

JSONのみを返してください。説明やマークダウンは不要です。`;
}
