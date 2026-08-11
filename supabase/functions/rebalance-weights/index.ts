/**
 * rebalance-weights/index.ts
 *
 * Scheduled edge function that calls compute_model_weights() in Postgres
 * to rebalance consensus weights for all 5 AI models based on the last
 * 30 days of audit logs.
 *
 * Invoke manually:  supabase functions invoke rebalance-weights
 * Scheduled use:    Call from a cron service or BackgroundSyncManager
 *                   once every 24 hours.
 *
 * Returns: { success, weights: [{ model_id, new_weight, based_on }] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  secureHeaders,
  secureResponse,
  secureErrorResponse,
  applySecurityMiddleware,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: secureHeaders });

  try {
    // Allow both POST and GET for scheduler compatibility
    if (req.method !== 'POST' && req.method !== 'GET') return secureErrorResponse('Method not allowed', 405);

    const { guard } = await applySecurityMiddleware(req, {
      rateLimit: { max: 20, windowSec: 3600, blockSec: 3600 }, // max 20 per hour
      maxPayloadBytes: 1_024,
      rateLimitScope: 'rebalance-weights',
      blockBotUa: false,
      sanitizeInput: false,
      verifySignature: false,
    });
    if (guard) return guard;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Call the stored procedure
    const { data, error } = await supabase.rpc('compute_model_weights');

    if (error) {
      console.error('compute_model_weights error:', error.message);
      // Don't fail entirely — return partial success so scheduled_jobs update
      return secureResponse({
        success: false,
        error: error.message,
        rebalanced_at: new Date().toISOString(),
        weights: [],
      });
    }

    return secureResponse({
      success: true,
      rebalanced_at: new Date().toISOString(),
      weights: data ?? [],
    });
  } catch (e) {
    return secureErrorResponse('Internal server error', 500);
  }
});
