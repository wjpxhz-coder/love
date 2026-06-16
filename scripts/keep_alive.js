const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tveiegolbotlqpjpwpes.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_AhdN1U9vSR1efN_5zDYMLQ_D_fyt3gN';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Inserting a dummy moment...");
  const { data, error } = await supabase.from('moments')
    .insert([{ type: 'text', content: 'keep-alive-ping', author: '小蛇' }])
    .select();

  if (error) {
    console.error("Insert error:", error);
    return;
  }

  if (data && data.length > 0) {
    const id = data[0].id;
    console.log("Inserted moment id:", id);
    console.log("Deleting moment id:", id);

    const { error: delError } = await supabase.from('moments').delete().eq('id', id);
    if (delError) {
      console.error("Delete error:", delError);
    } else {
      console.log("Deleted successfully.");
    }
  } else {
    console.log("No data returned from insert.");
  }
}

run();
