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
    free: 'gemini-2.5-flash-lite',       // 2.5 Flash Lite（高速・軽量）
    premium: 'gemini-2.5-flash',    // 2.5 Flash（思考モデル・高精度）
    pro: 'gemini-2.5-pro'           // 2.5 Pro（最高精度・深層分析）
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

  // プランに応じたタイムアウト（ミリ秒）
  const timeoutMs = plan === 'pro' ? 55000 : plan === 'premium' ? 40000 : 25000;

  try {
    // まずメインモデルで試行
    let result = await callGemini(apiKey, model, systemPrompt, text, timeoutMs);
    let usedModel = model;

    // Pro/Premiumモデルが高負荷の場合、2.0 Flashにフォールバック
    if (result.error && model !== 'gemini-2.5-flash-lite') {
      console.warn(`${model} failed (${result.detail}), falling back to gemini-2.5-flash-lite`);
      const fallbackPrompt = plan === 'pro' ? buildProPrompt(sceneDesc) : buildStandardPrompt(sceneDesc);
      result = await callGemini(apiKey, 'gemini-2.5-flash-lite', fallbackPrompt, text, 25000);
      usedModel = 'gemini-2.5-flash-lite';

      if (result.error) {
        return res.status(503).json(result);
      }

      result._fallback = true;
      result._originalModel = model;
    } else if (result.error) {
      return res.status(503).json(result);
    }

    // レスポンスにモデル情報を追加
    result._model = usedModel;
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

// Gemini API呼び出しヘルパー（エラー時は { error, detail } を返す）
async function callGemini(apiKey, model, systemPrompt, text, timeoutMs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // タイムアウト用のAbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
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

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`Gemini API error (${model}):`, response.status, errorData);
      return {
        error: 'AI分析に失敗しました',
        detail: errorData.error?.message || `HTTP ${response.status}`
      };
    }

    const data = await response.json();

    // thinking model の場合、parts に thought パートと text パートが混在する
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      console.error('No parts in response:', JSON.stringify(data).substring(0, 500));
      return { error: 'AIからの応答が空です', detail: 'No parts' };
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
      return { error: 'AIの応答にテキストが含まれていません', detail: 'No text' };
    }

    // JSONを抽出
    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        console.error('Failed to parse JSON:', content.substring(0, 300));
        return { error: 'AIの応答をパースできませんでした', detail: 'JSON parse failed' };
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`Gemini API timeout (${model}, ${timeoutMs}ms)`);
      return {
        error: 'AI分析がタイムアウトしました。再度お試しください。',
        detail: 'timeout'
      };
    }
    throw err;
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
6. 心理的背景（psychology）: この発言の裏にある心理メカニズムを分析。防衛機制、認知バイアス、アタッチメントスタイルなどの心理学的観点から2-3文で解説
7. 人間関係の力学（dynamics）: 発言者と相手の関係性における上下関係、距離感、パワーバランスを分析。1-2文で解説
8. 危険度シグナル（riskSignal）: この会話における関係悪化リスクを評価
   - level: "safe" | "caution" | "warning" の3段階
   - message: リスクの説明（1文）
9. 文化的コンテキスト（culturalNote）: この表現が日本文化特有の「空気」「建前」「察し」とどう関係するかを1-2文で解説
10. 送り主プロファイル（senderProfile）: このメッセージの送り主のコミュニケーションタイプを推定
   - type: タイプ名（例: "回避型コミュニケーター", "受動的攻撃タイプ", "察してほしいタイプ", "ストレート表現者"など、日本語で簡潔に）
   - traits: そのタイプの特徴を1文で説明
   - tip: この人に対する効果的なコミュニケーションのコツを1文で

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
    "message": "リスキの説明"
  },
  "culturalNote": "文化的コンテキストの解説",
  "senderProfile": {
    "type": "タイプ名",
    "traits": "特徴の説明",
    "tip": "攻略ポイント"
  }
}

JSONのみを返してください。説明やマークダウンは不要です。`;
}
