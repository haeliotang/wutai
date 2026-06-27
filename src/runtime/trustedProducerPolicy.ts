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

export interface TrustedProducerEnrollmentInput {
  publicKeySha256: string;
  producerAdapter: string;
  packetType: string;
  label?: string;
  note?: string;
}

export const EMPTY_TRUSTED_PRODUCER_POLICY: TrustedProducerPolicy = {
  schemaVersion: 1,
  kind: "wutai.trusted_producer_policy",
  policyId: "local-empty",
  sourceLabel: "none",
  keys: [],
};

function uniqueKeyId(keys: TrustedProducerKey[], baseKeyId: string) {
  const existing = new Set(keys.map((key) => key.keyId));
  if (!existing.has(baseKeyId)) return baseKeyId;

  let suffix = 2;
  while (existing.has(`${baseKeyId}-${suffix}`)) suffix += 1;
  return `${baseKeyId}-${suffix}`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
}

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

  const producerMatches = matchingKeys.filter(
    (key) => !key.producerAdapter || key.producerAdapter === producerAdapter,
  );
  if (producerMatches.length === 0) {
    return {
      trusted: false,
      status: "producer_mismatch",
      key: matchingKeys[0],
      message:
        "The attestation key is known, but it is not trusted for this producer adapter.",
    };
  }

  const packetTypeMatched = producerMatches.find(
    (key) =>
      !key.allowedPacketTypes?.length ||
      (packetType && key.allowedPacketTypes.includes(packetType)),
  );
  if (!packetTypeMatched) {
    return {
      trusted: false,
      status: "packet_type_mismatch",
      key: producerMatches[0],
      message:
        "The attestation key is known, but it is not trusted for this packet type.",
    };
  }

  return {
    trusted: true,
    status: "trusted",
    key: packetTypeMatched,
    message: "The attestation key matches the local trusted producer policy.",
  };
}

export function enrollTrustedProducerKey(
  policy: TrustedProducerPolicy,
  {
    publicKeySha256,
    producerAdapter,
    packetType,
    label,
    note,
  }: TrustedProducerEnrollmentInput,
): TrustedProducerPolicy {
  const normalizedHash = publicKeySha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error("Trusted producer enrollment requires a 64-character public key hash.");
  }
  if (!producerAdapter.trim()) {
    throw new Error("Trusted producer enrollment requires a producer adapter.");
  }
  if (!packetType.trim()) {
    throw new Error("Trusted producer enrollment requires a packet type.");
  }

  const existingExact = policy.keys.find(
    (key) =>
      key.publicKeySha256 === normalizedHash &&
      key.status === "active" &&
      key.producerAdapter === producerAdapter &&
      key.allowedPacketTypes?.includes(packetType),
  );
  if (existingExact) return policy;

  const baseKeyId = slug(
    `enrolled-${producerAdapter}-${packetType}-${normalizedHash.slice(0, 12)}`,
  );
  const enrolledKey: TrustedProducerKey = {
    keyId: uniqueKeyId(policy.keys, baseKeyId || `enrolled-${normalizedHash.slice(0, 12)}`),
    label: label?.trim() || `Local ${producerAdapter} key ${normalizedHash.slice(0, 12)}`,
    publicKeySha256: normalizedHash,
    producerAdapter,
    allowedPacketTypes: [packetType],
    status: "active",
    note:
      note?.trim() ||
      "Locally enrolled from a verified packet attestation. This does not prove external identity.",
  };

  return {
    schemaVersion: 1,
    kind: "wutai.trusted_producer_policy",
    policyId:
      policy.keys.length > 0 && policy.policyId !== EMPTY_TRUSTED_PRODUCER_POLICY.policyId
        ? policy.policyId
        : "local-enrolled-producers",
    sourceLabel:
      policy.keys.length > 0 && policy.sourceLabel !== EMPTY_TRUSTED_PRODUCER_POLICY.sourceLabel
        ? policy.sourceLabel
        : "local enrollment",
    keys: [...policy.keys, enrolledKey],
  };
}

export function updateTrustedProducerKeyStatus(
  policy: TrustedProducerPolicy,
  keyId: string,
  status: TrustedProducerKey["status"],
): TrustedProducerPolicy {
  let matched = false;
  const keys = policy.keys.map((key) => {
    if (key.keyId !== keyId) return key;
    matched = true;
    return {
      ...key,
      status,
      note:
        status === "revoked"
          ? "Locally revoked by the user. This blocks matching packet attestations unless reactivated."
          : (key.note ?? "Locally reactivated by the user."),
    };
  });

  if (!matched) {
    throw new Error(`Trusted producer key not found: ${keyId}.`);
  }

  return {
    ...policy,
    keys,
  };
}
