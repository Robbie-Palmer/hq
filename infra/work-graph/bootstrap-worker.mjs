export default {
  fetch() {
    return new Response("Work Graph deployment pending", { status: 503 });
  },
};
