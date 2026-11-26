import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  FlaskConical,
  Play,
  Loader2,
  AlertCircle,
  Info,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import {
  runMlLabRegression,
  runMlLabClassification,
  runMlLabEvaluation,
  runMlLabClustering,
  runMlLabAssociationRules,
  runMlLabRecommendation,
  runMlLabPCA,
  runMlLabRL,
  getMlLabEthics,
} from "../services/api";

const LAB_TABS = [
  { id: "regression", label: "1. Regression" },
  { id: "classification", label: "2. Classification" },
  { id: "evaluation", label: "3. Model Evaluation" },
  { id: "clustering", label: "4. Clustering" },
  { id: "association", label: "5. Association Rules" },
  { id: "recommendation", label: "6. Recommendation" },
  { id: "pca", label: "7. PCA" },
  { id: "rl", label: "8. Reinforcement Learning" },
  { id: "ethics", label: "9. AI Ethics" },
];

const CLUSTER_COLORS = ["#10b981", "#38bdf8", "#f59e0b", "#a855f7", "#f43f5e", "#14b8a6", "#eab308"];
const LEVEL_COLORS = { Low: "#10b981", Medium: "#f59e0b", High: "#ef4444" };

function MetricCard({ label, value, subtext }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-1.5 text-xl font-bold text-slate-900">{value}</p>
      {subtext && <p className="mt-0.5 text-[11px] text-slate-500">{subtext}</p>}
    </div>
  );
}

function ExplanationBox({ text }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs leading-relaxed text-slate-700">
      <Info size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      <p>{text}</p>
    </div>
  );
}

export default function MlLaboratory() {
  const [activeTab, setActiveTab] = useState("regression");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState({});

  // Controls per tab
  const [regAlg, setRegAlg] = useState("linear");
  const [regDegree, setRegDegree] = useState(2);

  const [clfAlg, setClfAlg] = useState("random_forest");
  const [knnK, setKnnK] = useState(5);
  const [treeDepth, setTreeDepth] = useState(10);

  const [evalMode, setEvalMode] = useState("overfitting_underfitting");
  const [evalFolds, setEvalFolds] = useState(5);

  const [clusterAlg, setClusterAlg] = useState("kmeans");
  const [nClusters, setNClusters] = useState(3);
  const [dbscanEps, setDbscanEps] = useState(0.85);

  const [assocAlg, setAssocAlg] = useState("apriori");
  const [minSupport, setMinSupport] = useState(0.10);
  const [minConfidence, setMinConfidence] = useState(0.55);

  const [recSlot, setRecSlot] = useState("morning_rush");
  const [recWeather, setRecWeather] = useState("Clear");
  const [recLowCongestion, setRecLowCongestion] = useState(true);

  const [pcaComponents, setPcaComponents] = useState(2);

  const [rlEpisodes, setRlEpisodes] = useState(35);
  const [rlEpsilon, setRlEpsilon] = useState(0.2);

  const executeTab = async (tabId = activeTab) => {
    setIsLoading(true);
    setError(null);
    try {
      let data;
      if (tabId === "regression") {
        data = await runMlLabRegression({ algorithm: regAlg, degree: Number(regDegree) });
      } else if (tabId === "classification") {
        data = await runMlLabClassification({
          algorithm: clfAlg,
          k: Number(knnK),
          max_depth: Number(treeDepth),
        });
      } else if (tabId === "evaluation") {
        data = await runMlLabEvaluation({ mode: evalMode, k_folds: Number(evalFolds) });
      } else if (tabId === "clustering") {
        data = await runMlLabClustering({
          algorithm: clusterAlg,
          n_clusters: Number(nClusters),
          eps: Number(dbscanEps),
        });
      } else if (tabId === "association") {
        data = await runMlLabAssociationRules({
          algorithm: assocAlg,
          min_support: Number(minSupport),
          min_confidence: Number(minConfidence),
        });
      } else if (tabId === "recommendation") {
        data = await runMlLabRecommendation({
          preferred_time_slot: recSlot,
          weather_condition: recWeather,
          prefer_low_congestion: recLowCongestion,
        });
      } else if (tabId === "pca") {
        data = await runMlLabPCA({ n_components: Number(pcaComponents) });
      } else if (tabId === "rl") {
        data = await runMlLabRL({ episodes: Number(rlEpisodes), epsilon: Number(rlEpsilon) });
      } else if (tabId === "ethics") {
        data = await getMlLabEthics();
      }
      setResults((prev) => ({ ...prev, [tabId]: data }));
    } catch (err) {
      setError(err.message || "Experiment failed to run.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "ethics" && !results.ethics) {
      let active = true;
      getMlLabEthics()
        .then((data) => {
          if (active) setResults((prev) => ({ ...prev, ethics: data }));
        })
        .catch((err) => {
          if (active) setError(err.message || "Failed to load AI ethics content.");
        });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [activeTab, results.ethics]);

  const current = results[activeTab];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-emerald-600">
            <FlaskConical size={20} />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Interactive ML Syllabus Lab
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Machine Learning Laboratory
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live scikit-learn, association-rule, PCA, recommender, and Q-learning experiments on the UCI traffic dataset.
          </p>
        </div>
      </div>

      {/* Module Tabs */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        {LAB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setError(null);
              setActiveTab(tab.id);
            }}
            className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls Bar */}
      {activeTab !== "ethics" && (
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-end gap-4">
            {activeTab === "regression" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Algorithm</span>
                  <select
                    value={regAlg}
                    onChange={(e) => setRegAlg(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="linear">Linear Regression (Hour)</option>
                    <option value="multiple">Multiple Linear Regression</option>
                    <option value="polynomial">Polynomial Regression</option>
                  </select>
                </label>
                {regAlg === "polynomial" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Degree (2-5)</span>
                    <input
                      type="number"
                      min={2}
                      max={5}
                      value={regDegree}
                      onChange={(e) => setRegDegree(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                )}
              </>
            )}

            {activeTab === "classification" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Classifier</span>
                  <select
                    value={clfAlg}
                    onChange={(e) => setClfAlg(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="logistic_regression">Logistic Regression</option>
                    <option value="knn">K-Nearest Neighbors (KNN)</option>
                    <option value="decision_tree">Decision Tree</option>
                    <option value="random_forest">Random Forest</option>
                    <option value="naive_bayes">Naive Bayes (Gaussian)</option>
                    <option value="svm">Support Vector Machine (SVM)</option>
                  </select>
                </label>
                {clfAlg === "knn" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Neighbors (k)</span>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={knnK}
                      onChange={(e) => setKnnK(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                )}
                {clfAlg === "decision_tree" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Max Depth</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={treeDepth}
                      onChange={(e) => setTreeDepth(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                )}
              </>
            )}

            {activeTab === "evaluation" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Validation Experiment</span>
                  <select
                    value={evalMode}
                    onChange={(e) => setEvalMode(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="overfitting_underfitting">Overfitting vs Underfitting</option>
                    <option value="bias_variance">Bias-Variance Trade-off</option>
                    <option value="cross_validation">K-Fold Cross Validation</option>
                    <option value="train_test_split">Train-Test Split Comparison</option>
                  </select>
                </label>
                {evalMode === "cross_validation" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Folds (k)</span>
                    <input
                      type="number"
                      min={3}
                      max={10}
                      value={evalFolds}
                      onChange={(e) => setEvalFolds(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                )}
              </>
            )}

            {activeTab === "clustering" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Clustering Algorithm</span>
                  <select
                    value={clusterAlg}
                    onChange={(e) => setClusterAlg(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="kmeans">K-Means Clustering</option>
                    <option value="hierarchical">Hierarchical (Ward)</option>
                    <option value="dbscan">DBSCAN</option>
                  </select>
                </label>
                {clusterAlg !== "dbscan" ? (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Clusters (k)</span>
                    <input
                      type="number"
                      min={2}
                      max={7}
                      value={nClusters}
                      onChange={(e) => setNClusters(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-slate-600">Epsilon (eps)</span>
                    <input
                      type="number"
                      min={0.2}
                      max={3.0}
                      step={0.05}
                      value={dbscanEps}
                      onChange={(e) => setDbscanEps(e.target.value)}
                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                )}
              </>
            )}

            {activeTab === "association" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Algorithm</span>
                  <select
                    value={assocAlg}
                    onChange={(e) => setAssocAlg(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="apriori">Apriori Algorithm</option>
                    <option value="fpgrowth">FP-Growth Algorithm</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Min Support</span>
                  <input
                    type="number"
                    min={0.03}
                    max={0.5}
                    step={0.01}
                    value={minSupport}
                    onChange={(e) => setMinSupport(e.target.value)}
                    className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Min Confidence</span>
                  <input
                    type="number"
                    min={0.2}
                    max={0.95}
                    step={0.05}
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(e.target.value)}
                    className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              </>
            )}

            {activeTab === "recommendation" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Preferred Time Slot</span>
                  <select
                    value={recSlot}
                    onChange={(e) => setRecSlot(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="morning_rush">Morning Rush (08:00)</option>
                    <option value="midday">Midday (13:00)</option>
                    <option value="evening_rush">Evening Rush (17:30)</option>
                    <option value="night">Off-Peak Night (22:00)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Weather Preference</span>
                  <select
                    value={recWeather}
                    onChange={(e) => setRecWeather(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="Clear">Clear</option>
                    <option value="Clouds">Clouds</option>
                    <option value="Rain">Rain</option>
                    <option value="Mist">Mist</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={recLowCongestion}
                    onChange={(e) => setRecLowCongestion(e.target.checked)}
                    className="rounded border-slate-300 bg-slate-50"
                  />
                  <span>Prefer Low Congestion</span>
                </label>
              </>
            )}

            {activeTab === "pca" && (
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-600">Principal Components</span>
                <input
                  type="number"
                  min={2}
                  max={6}
                  value={pcaComponents}
                  onChange={(e) => setPcaComponents(e.target.value)}
                  className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                />
              </label>
            )}

            {activeTab === "rl" && (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Episodes</span>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    value={rlEpisodes}
                    onChange={(e) => setRlEpisodes(e.target.value)}
                    className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-600">Exploration (epsilon)</span>
                  <input
                    type="number"
                    min={0.05}
                    max={0.5}
                    step={0.05}
                    value={rlEpsilon}
                    onChange={(e) => setRlEpsilon(e.target.value)}
                    className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => executeTab(activeTab)}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            <span>{isLoading ? "Running..." : "Run Experiment"}</span>
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty prompt before first run */}
      {!current && activeTab !== "ethics" && !isLoading && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <Sparkles className="mx-auto text-emerald-600" size={28} />
          <p className="mt-3 text-sm font-semibold text-slate-900">Ready to run experiment</p>
          <p className="mt-1 text-xs text-slate-600">
            Select your algorithm and parameters above, then click <strong className="text-emerald-600">Run Experiment</strong>.
          </p>
        </div>
      )}

      {/* Results Views */}
      {current && activeTab === "regression" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard label="MAE" value={current.metrics.mae} subtext="Mean Absolute Error" />
            <MetricCard label="MSE" value={current.metrics.mse} subtext="Mean Squared Error" />
            <MetricCard label="RMSE" value={current.metrics.rmse} subtext="Root Mean Squared Error" />
            <MetricCard label="R² Score" value={current.metrics.r2_score} subtext="Explained Variance" />
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={current.chart_points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="index" stroke="#475569" fontSize={11} />
                <YAxis stroke="#475569" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                <Legend />
                <Line type="monotone" dataKey="actual" name="Actual Volume" stroke="#10b981" strokeWidth={2} />
                <Line type="monotone" dataKey="predicted" name="Predicted Volume" stroke="#38bdf8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "classification" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard label="Accuracy" value={(current.metrics.accuracy * 100).toFixed(2) + "%"} />
            <MetricCard label="Macro Precision" value={current.metrics.precision} />
            <MetricCard label="Macro Recall" value={current.metrics.recall} />
            <MetricCard label="Macro F1-Score" value={current.metrics.f1_score} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Confusion Matrix (Rows: Actual, Cols: Predicted)
              </h3>
              <table className="w-full rounded-xl border border-slate-200 text-center text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2.5">Actual \ Pred</th>
                    {current.labels.map((l) => (
                      <th key={l} className="p-2.5">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {current.confusion_matrix.map((row, rIdx) => (
                    <tr key={current.labels[rIdx]}>
                      <td className="bg-slate-50 p-2.5 font-semibold text-slate-900">{current.labels[rIdx]}</td>
                      {row.map((val, cIdx) => (
                        <td
                          key={cIdx}
                          className={`p-2.5 font-mono ${rIdx === cIdx ? "bg-emerald-500/15 font-bold text-emerald-700" : "text-slate-700"}`}
                        >
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Per-Class Metrics
              </h3>
              <table className="w-full rounded-xl border border-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-2.5">Class</th>
                    <th className="p-2.5">Precision</th>
                    <th className="p-2.5">Recall</th>
                    <th className="p-2.5">F1</th>
                    <th className="p-2.5">Support</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {current.per_class.map((c) => (
                    <tr key={c.label}>
                      <td className="p-2.5 font-semibold text-slate-900">{c.label}</td>
                      <td className="p-2.5">{c.precision}</td>
                      <td className="p-2.5">{c.recall}</td>
                      <td className="p-2.5">{c.f1_score}</td>
                      <td className="p-2.5">{c.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "evaluation" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          {current.mean_accuracy !== undefined && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <MetricCard label="K-Folds" value={current.k_folds} />
              <MetricCard label="Mean CV Accuracy" value={(current.mean_accuracy * 100).toFixed(2) + "%"} />
              <MetricCard label="Std Deviation" value={current.std_accuracy} />
            </div>
          )}
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {current.mode === "overfitting_underfitting" ? (
                <LineChart data={current.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="depth" stroke="#475569" fontSize={11} />
                  <YAxis domain={[0.4, 1]} stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                  <Legend />
                  <Line type="monotone" dataKey="train_accuracy" name="Train Accuracy" stroke="#10b981" strokeWidth={2} />
                  <Line type="monotone" dataKey="test_accuracy" name="Test Accuracy" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              ) : (
                <BarChart data={current.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey={current.mode === "cross_validation" ? "fold" : current.mode === "bias_variance" ? "regime" : "model"}
                    stroke="#475569"
                    fontSize={11}
                  />
                  <YAxis domain={[0, 1]} stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                  <Legend />
                  {current.mode === "cross_validation" && (
                    <Bar dataKey="accuracy" name="Fold Accuracy" fill="#10b981" />
                  )}
                  {current.mode === "bias_variance" && (
                    <>
                      <Bar dataKey="train_accuracy" name="Train Accuracy" fill="#10b981" />
                      <Bar dataKey="cv_mean_accuracy" name="CV Mean Accuracy" fill="#38bdf8" />
                    </>
                  )}
                  {current.mode === "train_test_split" && (
                    <>
                      <Bar dataKey="accuracy" name="Accuracy" fill="#10b981" />
                      <Bar dataKey="f1_score" name="F1-Score" fill="#38bdf8" />
                    </>
                  )}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "clustering" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard label="Samples" value={current.sample_count} />
            <MetricCard label="Clusters Found" value={current.cluster_count} />
            <MetricCard label="Noise Points" value={current.noise_count} />
            <MetricCard
              label="Silhouette Score"
              value={current.silhouette_score !== null ? current.silhouette_score : "N/A"}
              subtext="[-1, +1] higher is tighter"
            />
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="pc1" name="PC1" stroke="#475569" fontSize={11} />
                <YAxis type="number" dataKey="pc2" name="PC2" stroke="#475569" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                <Scatter name="Traffic Observations" data={current.scatter_points}>
                  {current.scatter_points.map((pt, idx) => (
                    <Cell
                      key={idx}
                      fill={pt.cluster === -1 ? "#64748b" : CLUSTER_COLORS[pt.cluster % CLUSTER_COLORS.length]}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full rounded-xl border border-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2.5">Cluster</th>
                <th className="p-2.5">Count</th>
                <th className="p-2.5">Avg Volume</th>
                <th className="p-2.5">Avg Hour</th>
                <th className="p-2.5">Avg Clouds %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {current.cluster_profiles.map((c) => (
                <tr key={c.cluster}>
                  <td className="p-2.5 font-semibold text-slate-900">{c.cluster}</td>
                  <td className="p-2.5">{c.count}</td>
                  <td className="p-2.5">{c.avg_volume}</td>
                  <td className="p-2.5">{c.avg_hour}</td>
                  <td className="p-2.5">{c.avg_clouds}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "association" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Transactions" value={current.transaction_count} />
            <MetricCard label="Frequent Itemsets" value={current.itemset_count} />
            <MetricCard label="Rules Discovered" value={current.rule_count} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full rounded-xl border border-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2.5">Antecedent (If)</th>
                  <th className="p-2.5">Consequent (Then)</th>
                  <th className="p-2.5">Support</th>
                  <th className="p-2.5">Confidence</th>
                  <th className="p-2.5">Lift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {current.rules.map((r, i) => (
                  <tr key={i}>
                    <td className="p-2.5 text-slate-900">{r.antecedent}</td>
                    <td className="p-2.5 text-emerald-700">{r.consequent}</td>
                    <td className="p-2.5">{r.support}</td>
                    <td className="p-2.5">{r.confidence}</td>
                    <td className="p-2.5 font-semibold">{r.lift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "recommendation" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="overflow-x-auto">
            <table className="w-full rounded-xl border border-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2.5">Recommended Window</th>
                  <th className="p-2.5">Weather</th>
                  <th className="p-2.5">Expected Volume</th>
                  <th className="p-2.5">Congestion</th>
                  <th className="p-2.5">Cosine Similarity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {current.recommendations.map((rec, idx) => (
                  <tr key={idx}>
                    <td className="p-2.5 font-semibold text-slate-900">{rec.window}</td>
                    <td className="p-2.5">{rec.weather}</td>
                    <td className="p-2.5">{rec.expected_volume}</td>
                    <td className="p-2.5">{rec.congestion_level}</td>
                    <td className="p-2.5 font-mono text-emerald-600">{rec.similarity_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "pca" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <MetricCard
              label="Total Variance Explained"
              value={(current.total_variance_explained * 100).toFixed(2) + "%"}
            />
            {current.variance_summary.slice(0, 2).map((v) => (
              <MetricCard
                key={v.component}
                label={v.component}
                value={(v.explained_variance * 100).toFixed(2) + "%"}
                subtext={`Cumulative: ${(v.cumulative_variance * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="pc1" name="PC1" stroke="#475569" fontSize={11} />
                <YAxis type="number" dataKey="pc2" name="PC2" stroke="#475569" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                <Scatter name="2D PCA Projection" data={current.scatter_points}>
                  {current.scatter_points.map((pt, idx) => (
                    <Cell key={idx} fill={LEVEL_COLORS[pt.level] || "#10b981"} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "rl" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 md:grid-cols-2">
            <div><strong className="text-slate-900">Agent:</strong> {current.rl_process.agent}</div>
            <div><strong className="text-slate-900">Environment:</strong> {current.rl_process.environment}</div>
            <div><strong className="text-slate-900">State:</strong> {current.rl_process.state}</div>
            <div><strong className="text-slate-900">Action:</strong> {current.rl_process.action}</div>
            <div className="md:col-span-2"><strong className="text-slate-900">Reward:</strong> {current.rl_process.reward}</div>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={current.learning_curve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="episode" stroke="#475569" fontSize={11} />
                  <YAxis stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                  <Line type="monotone" dataKey="total_reward" name="Episode Reward" stroke="#10b981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={current.strategy_comparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="strategy" stroke="#475569" fontSize={11} />
                  <YAxis stroke="#475569" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0" }} />
                  <Bar dataKey="avg_queue" name="Avg Total Queue" fill="#38bdf8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <ExplanationBox text={current.explanation} />
        </div>
      )}

      {current && activeTab === "ethics" && (
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck size={18} />
            <h2 className="text-base font-bold text-slate-900">{current.title}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {current.pillars.map((p) => (
              <div key={p.topic} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">{p.topic}</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-700">{p.summary}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Future Trends in Traffic AI & ML</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-slate-700">
              {current.future_trends.map((trend) => (
                <li key={trend}>{trend}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
