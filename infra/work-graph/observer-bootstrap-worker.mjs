export default {
  fetch() {
    return Response.json(
      { error: "Work Graph observer deployment is pending" },
      { status: 503 },
    );
  },
};
