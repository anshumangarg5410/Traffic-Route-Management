import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../services/api.js";

test("ML Laboratory — exports all 9 experiment API functions", () => {
  const fns = [
    "runMlLabRegression",
    "runMlLabClassification",
    "runMlLabEvaluation",
    "runMlLabClustering",
    "runMlLabAssociationRules",
    "runMlLabRecommendation",
    "runMlLabPCA",
    "runMlLabRL",
    "getMlLabEthics",
  ];
  for (const name of fns) {
    assert.equal(typeof api[name], "function", `${name} must be exported`);
  }
});

test("ML Laboratory — API functions call expected /ml-lab endpoints", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  try {
    await api.runMlLabRegression({ algorithm: "linear" });
    await api.runMlLabClassification({ algorithm: "svm" });
    await api.runMlLabEvaluation({ mode: "cross_validation" });
    await api.runMlLabClustering({ algorithm: "kmeans" });
    await api.runMlLabAssociationRules({ algorithm: "apriori" });
    await api.runMlLabRecommendation({ preferred_time_slot: "morning_rush" });
    await api.runMlLabPCA({ n_components: 2 });
    await api.runMlLabRL({ episodes: 20 });
    await api.getMlLabEthics();

    assert.equal(calls.length, 9);
    assert.ok(calls[0].url.endsWith("/ml-lab/regression") && calls[0].method === "POST");
    assert.ok(calls[1].url.endsWith("/ml-lab/classification") && calls[1].method === "POST");
    assert.ok(calls[2].url.endsWith("/ml-lab/evaluation") && calls[2].method === "POST");
    assert.ok(calls[3].url.endsWith("/ml-lab/clustering") && calls[3].method === "POST");
    assert.ok(calls[4].url.endsWith("/ml-lab/association-rules") && calls[4].method === "POST");
    assert.ok(calls[5].url.endsWith("/ml-lab/recommendation") && calls[5].method === "POST");
    assert.ok(calls[6].url.endsWith("/ml-lab/pca") && calls[6].method === "POST");
    assert.ok(calls[7].url.endsWith("/ml-lab/reinforcement-learning") && calls[7].method === "POST");
    assert.ok(calls[8].url.endsWith("/ml-lab/ethics") && calls[8].method === "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
