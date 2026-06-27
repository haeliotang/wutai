export interface TrustedProducerKey {
  keyId: string;
  label: string;
  publicKeySha256: string;
  producerAdapter?: string;
  allowedPacketTypes?: string[];
  status: "active" | "revoked";
  note?: string;
}

export interface TrustedProducerPolicy {
  schemaVersion: 1;
  kind: "wutai.trusted_producer_policy";
  policyId: string;
  sourceLabel: string;
  keys: TrustedProducerKey[];
}

export interface TrustedProducerEvaluation {
  trusted: boolean;
  status:
    | "trusted"
    | "not_provided"
    | "unknown_key"
    | "revoked"
    | "producer_mismatch"
    | "packet_type_mismatch";
  message: string;
  key?: TrustedProducerKey;
}

export const EMPTY_TRUSTED_PRODUCER_POLICY: TrustedProducerPolicy = {
  schemaVersion: 1,
  kind: "wutai.trusted_producer_policy",
  policyId: "local-empty",
  sourceLabel: "none",
  keys: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function parseTrustedProducerPolicy(
  content: string,
  sourceLabel = "local policy",
): TrustedProducerPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Trusted producer policy is not valid JSON.");
  }

  const root = asRecord(parsed);
  if (!root) {
    throw new Error("Trusted producer policy must be a JSON object.");
  }
  if (root.kind && root.kind !== "wutai.trusted_producer_policy") {
    throw new Error(
      `Unsupported trusted producer policy kind: ${String(root.kind)}.`,
    );
  }
  if (!Array.isArray(root.keys)) {
    throw new Error("Trusted producer policy must define a keys array.");
  }

  const keys = root.keys.map((item, index): TrustedProducerKey => {
    const key = asRecord(item);
    if (!key) {
      throw new Error(`Trusted producer key ${index + 1} must be an object.`);
    }

    const publicKeySha256 =
      typeof key.publicKeySha256 === "string"
        ? key.publicKeySha256.trim().toLowerCase()
        : "";
    if (!/^[a-f0-9]{64}$/.test(publicKeySha256)) {
      throw new Error(
        `Trusted producer key ${index + 1} must provide a 64-character publicKeySha256.`,
      );
    }

    const status = key.status === "revoked" ? "revoked" : "active";
    const keyId =
      typeof key.keyId === "string" && key.keyId.trim()
        ? key.keyId.trim()
        : `key-${index + 1}`;
    const label =
      typeof key.label === "string" && key.label.trim()
        ? key.label.trim()
        : keyId;
    const producerAdapter =
      typeof key.producerAdapter === "string" && key.producerAdapter.trim()
        ? key.producerAdapter.trim()
        : undefined;
    const note =
      typeof key.note === "string" && key.note.trim()
        ? key.note.trim()
        : undefined;

    return {
      keyId,
      label,
      publicKeySha256,
      producerAdapter,
      allowedPacketTypes: normalizeStringList(key.allowedPacketTypes),
      status,
      note,
    };
  });

  return {
    schemaVersion: 1,
    kind: "wutai.trusted_producer_policy",
    policyId:
      typeof root.policyId === "string" && root.policyId.trim()
        ? root.policyId.trim()
        : "local-policy",
    sourceLabel,
    keys,
  };
}

export function evaluateTrustedProducerKey(
  policy: TrustedProducerPolicy | null | undefined,
  {
    publicKeySha256,
    producerAdapter,
    packetType,
  }: {
    publicKeySha256?: string;
    producerAdapter?: string;
    packetType?: string;
  },
): TrustedProducerEvaluation {
  if (!policy || policy.keys.length === 0) {
    return {
      trusted: false,
      status: "not_provided",
      message: "No local trusted producer policy is loaded.",
    };
  }
  if (!publicKeySha256) {
    return {
      trusted: false,
      status: "unknown_key",
      message: "Attestation does not provide a public key hash to match.",
    };
  }

  const matchingKeys = policy.keys.filter(
    (key) => key.publicKeySha256 === publicKeySha256.toLowerCase(),
  );
  if (matchingKeys.length === 0) {
    return {
      trusted: false,
      status: "unknown_key",
      message:
        "The attestation key is not present in the local trusted producer policy.",
    };
  }

  const revoked = matchingKeys.find((key) => key.status === "revoked");
  if (revoked) {
    return {
      trusted: false,
      status: "revoked",
      key: revoked,
      message: "The attestation key is explicitly revoked by the local policy.",
    };
  }

  const producerMatched = matchingKeys.find(
    (key) => !key.producerAdapter || key.producerAdapter === producerAdapter,
  );
  if (!producerMatched) {
    return {
      trusted: false,
      status: "producer_mismatch",
      key: matchingKeys[0],
      message:
        "The attestation key is known, but it is not trusted for this producer adapter.",
    };
  }

  if (
    producerMatched.allowedPacketTypes?.length &&
    (!packetType || !producerMatched.allowedPacketTypes.includes(packetType))
  ) {
    return {
      trusted: false,
      status: "packet_type_mismatch",
      key: producerMatched,
      message:
        "The attestation key is known, but it is not trusted for this packet type.",
    };
  }

  return {
    trusted: true,
    status: "trusted",
    key: producerMatched,
    message: "The attestation key matches the local trusted producer policy.",
  };
}
