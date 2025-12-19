export const testClient = async (endpoint, data = {}) => {
  return {
    ok: true,
    reply: 'mocked testClient response',
    data,
  };
};
