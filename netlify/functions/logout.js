exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': 'lcg_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ok: true }),
  };
};
