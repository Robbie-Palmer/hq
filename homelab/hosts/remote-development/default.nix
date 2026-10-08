{
  config,
  pkgs,
  ...
}:

let
  dataDevice = "/dev/disk/by-id/scsi-0HC_Volume_106792547";
  dataMapper = "remote-development-data";
  dataMount = "/srv/remote-development";
  dataKeyFile = "/var/lib/remote-development-secrets/data-volume.key";
  operatorDataPath = "${dataMount}/t3-code";
  cacheDataPath = "${dataMount}/t3-code-cache";
  operatorProjectId = "2000";
  cacheProjectId = "2002";
  operatorBlockHardLimit = "55G";
  operatorBlockHardLimitKiB = "57671680";
  operatorInodeHardLimit = "3000000";
  cacheBlockHardLimit = "30G";
  cacheBlockHardLimitKiB = "31457280";
  cacheInodeHardLimit = "2000000";
  projectQuotaLayoutVersion = "2";
  observabilitySecretsDirectory = "/var/lib/remote-development-observability";
  operatorKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIj4+tNshoonWcOZFnSV0YcXgKuGqfcmn5HyIvLCfdQe robbiepalmer@live.co.uk";
  workspaceBackupInventory = builtins.fromJSON (
    builtins.readFile ../../remote-development-backup/inventory.json
  );
  workspaceBackupConfig = pkgs.writeText "remote-development-workspace-backup-config" ''
    WORKSPACE_ID=${workspaceBackupInventory.workspace.id}
    DESTINATION_PROVIDER=${workspaceBackupInventory.destination.provider}
    BACKUP_SOURCE=${workspaceBackupInventory.workspace.source}
    BACKUP_EXCLUDES_FILE=/etc/remote-development-workspace-backup/backup-excludes.txt
    BACKUP_STATUS_FILE=/var/lib/remote-development-backup/status.json
    BACKUP_CREDENTIALS_FILE=${workspaceBackupInventory.destination.credentialsFile}
    BACKUP_PASSWORD_FILE=${workspaceBackupInventory.destination.passwordFile}
    MAXIMUM_AGE_SECONDS=${toString workspaceBackupInventory.schedule.maximumAgeSeconds}
    KEEP_HOURLY=${toString workspaceBackupInventory.retention.hourly}
    KEEP_DAILY=${toString workspaceBackupInventory.retention.daily}
    KEEP_WEEKLY=${toString workspaceBackupInventory.retention.weekly}
    KEEP_MONTHLY=${toString workspaceBackupInventory.retention.monthly}
  '';
  workspaceBackup = pkgs.writeShellScriptBin "remote-development-workspace-backup" (
    builtins.readFile ../../scripts/remote-development-workspace-backup
  );
  workspaceBackupStatus = pkgs.writeShellScriptBin "remote-development-workspace-backup-status" (
    builtins.readFile ../../scripts/remote-development-workspace-backup-status
  );
  workspaceRestore = pkgs.writeShellScriptBin "remote-development-workspace-restore" (
    builtins.readFile ../../scripts/remote-development-workspace-restore
  );
  workspaceExport = pkgs.writeShellScriptBin "remote-development-workspace-export" (
    builtins.readFile ../../scripts/remote-development-workspace-export
  );
  observabilityMetricsConfig = pkgs.writeText "remote-development-observability-metrics.env" ''
    WORKSPACE_ID=${workspaceBackupInventory.workspace.id}
    DATA_MOUNT=${dataMount}
    OPERATOR_PROJECT_ID=${operatorProjectId}
    CACHE_PROJECT_ID=${cacheProjectId}
    BACKUP_STATUS_FILE=/var/lib/remote-development-backup/status.json
    BACKUP_MAXIMUM_AGE_SECONDS=${toString workspaceBackupInventory.schedule.maximumAgeSeconds}
    KUBE_STATE_METRICS_URL=http://127.0.0.1:18080/api/v1/namespaces/observability/services/http:kube-state-metrics:8080/proxy/metrics
  '';
  observabilityMetrics = pkgs.writeShellScriptBin "remote-development-observability-metrics" (
    builtins.readFile ../../scripts/remote-development-observability-metrics
  );
  netdataLibbpf = pkgs.fetchFromGitHub {
    owner = "netdata";
    repo = "libbpf";
    rev = "5acba1722d66a25ad5a545f9296e59d0cb73d548";
    hash = "sha256-fv+aTXbAixDmIGtNgJ2OT/HdbRXamixs7kMHA4oVlXU=";
  };
  netdataKernelCollector = pkgs.fetchurl {
    url = "https://github.com/netdata/kernel-collector/releases/download/v1.6.2.2/netdata-kernel-collector-static-v1.6.2.2.tar.xz";
    hash = "sha256-PWTOAHesXAdBQf7WwEur8A9nadzH7lRrGJPJMCUON+s=";
  };
  netdataEbpfCore = pkgs.fetchurl {
    url = "https://github.com/netdata/ebpf-co-re/releases/download/v1.6.2.1/netdata-ebpf-co-re-glibc-v1.6.2.1.tar.xz";
    hash = "sha256-PIv5WZ00iuX4uX2kiJM3i/Yvl/aIQkAzdYyqPmmUFIw=";
  };
  netdataPackage = (pkgs.netdata.override {
    libelf = pkgs.elfutils;
    withCloudUi = true;
    withEbpf = true;
  }).overrideAttrs (previous: {
    postPatch = (previous.postPatch or "") + ''
      substituteInPlace packaging/cmake/Modules/NetdataLibBPF.cmake \
        --replace-fail \
          'GIT_REPOSITORY https://github.com/netdata/libbpf.git' \
          'DOWNLOAD_COMMAND ${pkgs.cmake}/bin/cmake -E copy_directory ${netdataLibbpf} "''${libbpf_SOURCE_DIR}"' \
        --replace-fail \
          'GIT_TAG ''${_libbpf_tag}' \
          '# GIT_TAG replaced by the pinned Nix source'
      substituteInPlace packaging/cmake/Modules/NetdataEBPFLegacy.cmake \
        --replace-fail \
          'URL https://github.com/netdata/kernel-collector/releases/download/v1.6.2.2/netdata-kernel-collector-''${_libc}-v1.6.2.2.tar.xz' \
          'URL file://${netdataKernelCollector}'
      substituteInPlace packaging/cmake/Modules/NetdataEBPFCORE.cmake \
        --replace-fail \
          'URL https://github.com/netdata/ebpf-co-re/releases/download/v1.6.2.1/netdata-ebpf-co-re-glibc-v1.6.2.1.tar.xz' \
          'URL file://${netdataEbpfCore}'
    '';
    postInstall = (previous.postInstall or "") + ''
      mv $out/libexec/netdata/plugins.d/ebpf.plugin \
        $out/libexec/netdata/plugins.d/ebpf.plugin.org
    '';
    meta = previous.meta // {
      # Nixpkgs does not build-test this optional plugin. The host build below
      # is the deployment gate for the pinned package and its eBPF binary.
      broken = false;
    };
  });
  netdataPrivilegedPlugins = pkgs.runCommand "remote-development-netdata-privileged-plugins" { } ''
    mkdir -p $out/libexec/netdata/plugins.d
    ln -s /run/wrappers/bin/netdata-ebpf $out/libexec/netdata/plugins.d/ebpf.plugin
  '';
in
{
  imports = [
    ./disk-config.nix
    ./hardware-configuration.nix
  ];

  assertions = [
    {
      assertion = dataDevice != "/dev/sda";
      message = "The persistent data volume must not be the disko-managed root disk.";
    }
    {
      assertion = workspaceBackupInventory.workspace.source == operatorDataPath;
      message = "The workspace backup source must match the durable operator data path.";
    }
    {
      assertion = workspaceBackupInventory.workspace.rebuildableCache == cacheDataPath;
      message = "The workspace backup inventory must name the separate rebuildable cache path.";
    }
  ];

  nixpkgs.config.allowUnfreePredicate = package:
    builtins.elem (pkgs.lib.getName package) [ "netdata" ];

  networking = {
    hostName = "remote-development";
    firewall = {
      enable = true;
      checkReversePath = "loose";
      allowedUDPPorts = [ config.services.tailscale.port ];
      trustedInterfaces = [ "tailscale0" ];
    };
  };

  boot = {
    loader.grub = {
      enable = true;
      configurationLimit = 10;
    };
    tmp.cleanOnBoot = true;
  };

  zramSwap = {
    enable = true;
    algorithm = "zstd";
    memoryPercent = 25;
    priority = 100;
  };

  environment.etc = {
    crypttab.text = ''
      ${dataMapper} ${dataDevice} ${dataKeyFile} luks,nofail
    '';
    projects.text = ''
      ${operatorProjectId}:${operatorDataPath}
      ${cacheProjectId}:${cacheDataPath}
    '';
    projid.text = ''
      t3-code-operator:${operatorProjectId}
      t3-code-cache:${cacheProjectId}
    '';
    "remote-development-workspace-backup/config".source = workspaceBackupConfig;
    "remote-development-workspace-backup/backup-excludes.txt".source =
      ../../remote-development-backup/backup-excludes.txt;
    "remote-development-workspace-backup/export-excludes.txt".source =
      ../../remote-development-backup/export-excludes.txt;
    "remote-development-observability/metrics.env".source = observabilityMetricsConfig;
  };

  fileSystems.${dataMount} = {
    device = "/dev/mapper/${dataMapper}";
    fsType = "ext4";
    options = [
      "nofail"
      "noatime"
      "prjquota"
      "x-systemd.device-timeout=30s"
    ];
  };

  systemd.tmpfiles.rules = [
    "d /var/lib/remote-development-secrets 0700 root root -"
    "d /var/lib/remote-development-backup 0700 root root -"
    "d ${observabilitySecretsDirectory} 0700 root root -"
  ];

  users = {
    mutableUsers = false;
    groups.t3code.gid = 2000;
    users = {
      root.openssh.authorizedKeys.keys = [ operatorKey ];
      robbie = {
        isNormalUser = true;
        uid = 1000;
        extraGroups = [ "wheel" ];
        openssh.authorizedKeys.keys = [ operatorKey ];
      };
      t3code = {
        isSystemUser = true;
        uid = 2000;
        group = "t3code";
        home = "${operatorDataPath}/home";
        createHome = false;
      };
    };
  };

  security.sudo.wheelNeedsPassword = false;

  services = {
    openssh = {
      enable = true;
      openFirewall = true;
      settings = {
        AllowUsers = [
          "root"
          "robbie"
        ];
        KbdInteractiveAuthentication = false;
        PasswordAuthentication = false;
        PermitRootLogin = "prohibit-password";
        X11Forwarding = false;
      };
    };

    tailscale = {
      enable = true;
      extraSetFlags = [ "--ssh" ];
    };

    k3s = {
      enable = true;
      role = "server";
      nodeName = "remote-development";
      nodeLabel = [
        "homelab.dev/location=cloud"
        "homelab.dev/capability=agent-workspace"
        "homelab.dev/power-profile=always-on"
      ];
      disable = [
        "servicelb"
        "traefik"
      ];
      extraFlags = [
        "--secrets-encryption"
        "--write-kubeconfig-mode=0640"
      ];
      gracefulNodeShutdown.enable = true;
      extraKubeletConfig = {
        containerLogMaxFiles = 3;
        containerLogMaxSize = "20Mi";
        failSwapOn = false;
        memorySwap.swapBehavior = "NoSwap";
      };
    };

    netdata = {
      enable = true;
      package = netdataPackage;
      enableAnalyticsReporting = false;
      extraPluginPaths = [ "${netdataPrivilegedPlugins}/libexec/netdata/plugins.d" ];
      config = {
        global = {
          "hostname" = "remote-development";
        };
        db = {
          "mode" = "dbengine";
          "retention" = "7d";
        };
        web = {
          "bind to" = "tcp:127.0.0.1:19999";
          "allow connections from" = "localhost";
          "allow dashboard from" = "localhost";
        };
        cloud."enabled" = "no";
        statsd = {
          "enabled" = "yes";
          "bind to" = "udp:127.0.0.1:8125";
          "create private charts for metrics matching" = "!remote_development.* *";
        };
        plugins = {
          "cgroups" = "yes";
          "ebpf" = "yes";
          "go.d" = "yes";
          "proc" = "yes";
        };
      };
      configDir = {
        "ebpf.d/oomkill.conf" = ./netdata/ebpf.d/oomkill.conf;
        "go.d/prometheus.conf" = ./netdata/go.d/prometheus.conf;
        "health.d/remote-development.conf" = ./netdata/health.d/remote-development.conf;
        "health_alarm_notify.conf" = ./netdata/health_alarm_notify.conf;
        "statsd.d/remote-development.conf" = ./netdata/statsd.d/remote-development.conf;
      };
    };

    journald.extraConfig = ''
      SystemMaxUse=1G
      RuntimeMaxUse=256M
      MaxRetentionSec=14day
      Compress=yes
    '';
  };

  systemd.services.remote-development-data-layout = {
    description = "Create persistent remote-development data directories";
    after = [ "srv-remote\\x2ddevelopment.mount" ];
    requires = [ "srv-remote\\x2ddevelopment.mount" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      install -d -m 2770 -o t3code -g t3code ${operatorDataPath}
      install -d -m 0750 -o t3code -g t3code ${operatorDataPath}/home
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.t3
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.codex
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.codex-personal
      install -d -m 0750 -o t3code -g t3code ${operatorDataPath}/workspaces
      install -d -m 2770 -o t3code -g t3code ${cacheDataPath}
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/home-cache
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/mise
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/pnpm
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/arduino15
    '';
  };

  systemd.services.remote-development-project-quotas = {
    description = "Apply remote-development project quotas";
    after = [ "remote-development-data-layout.service" ];
    requires = [ "remote-development-data-layout.service" ];
    before = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    path = [
      pkgs.coreutils
      pkgs.e2fsprogs
      pkgs.findutils
      pkgs.gawk
      pkgs.gnugrep
      pkgs.quota
      pkgs.util-linux
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      StateDirectory = "remote-development";
      StateDirectoryMode = "0700";
    };
    script = ''
      test "$(findmnt --noheadings --output FSTYPE --target ${dataMount})" = ext4
      findmnt --noheadings --output OPTIONS --target ${dataMount} \
        | tr ',' '\n' \
        | grep -Fx prjquota >/dev/null

      if ! quotaon --project --print-state ${dataMount} | grep -F ' is on' >/dev/null; then
        quotaon --project ${dataMount}
      fi

      quota_state="${projectQuotaLayoutVersion}:$(findmnt --noheadings --output UUID --target ${dataMount} | tr -d ' ')"
      quota_state_file=/var/lib/remote-development/project-quota-layout
      if [ "$(cat "$quota_state_file" 2>/dev/null || true)" != "$quota_state" ]; then
        find "${operatorDataPath}" -xdev ! -type l -exec chattr -p "${operatorProjectId}" {} +
        find "${cacheDataPath}" -xdev ! -type l -exec chattr -p "${cacheProjectId}" {} +
      fi

      chattr +P ${operatorDataPath}
      setquota --project ${operatorProjectId} 0 ${operatorBlockHardLimit} 0 ${operatorInodeHardLimit} ${dataMount}

      chattr +P ${cacheDataPath}
      setquota --project ${cacheProjectId} 0 ${cacheBlockHardLimit} 0 ${cacheInodeHardLimit} ${dataMount}

      test "$(lsattr -dp ${operatorDataPath} | awk '{ print $1 }')" = ${operatorProjectId}
      lsattr -d ${operatorDataPath} | awk '{ print $1 }' | grep -F P >/dev/null
      test "$(lsattr -dp ${cacheDataPath} | awk '{ print $1 }')" = ${cacheProjectId}
      lsattr -d ${cacheDataPath} | awk '{ print $1 }' | grep -F P >/dev/null
      repquota --project --verbose --no-names --output=csv ${dataMount} \
        | awk -F, '
          $1 == "#${operatorProjectId}" {
            operator_found = 1
            if ($6 != "${operatorBlockHardLimitKiB}" || $10 != "${operatorInodeHardLimit}") exit 1
          }
          $1 == "#${cacheProjectId}" {
            cache_found = 1
            if ($6 != "${cacheBlockHardLimitKiB}" || $10 != "${cacheInodeHardLimit}") exit 1
          }
          END { if (!operator_found || !cache_found) exit 1 }'
      quota_state_tmp="$(mktemp "$quota_state_file.XXXXXX")"
      trap 'rm -f -- "$quota_state_tmp"' EXIT
      printf '%s\n' "$quota_state" >"$quota_state_tmp"
      chmod 0600 "$quota_state_tmp"
      mv -f -- "$quota_state_tmp" "$quota_state_file"
      trap - EXIT
    '';
  };

  systemd.services.remote-development-workspace-backup = {
    description = "Back up the operator workspace to encrypted off-provider storage";
    after = [
      "network-online.target"
      "srv-remote\\x2ddevelopment.mount"
    ];
    wants = [ "network-online.target" ];
    requires = [ "srv-remote\\x2ddevelopment.mount" ];
    path = [
      pkgs.coreutils
      pkgs.findutils
      pkgs.jq
      pkgs.restic
    ];
    environment.WORKSPACE_BACKUP_CONFIG =
      "/etc/remote-development-workspace-backup/config";
    serviceConfig = {
      Type = "oneshot";
      EnvironmentFile = workspaceBackupInventory.destination.credentialsFile;
      ExecStart = "${workspaceBackup}/bin/remote-development-workspace-backup";
      Nice = 10;
      IOSchedulingClass = "idle";
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
      ReadOnlyPaths = [ operatorDataPath ];
      ReadWritePaths = [ "/var/lib/remote-development-backup" ];
    };
    unitConfig.ConditionPathExists = workspaceBackupInventory.destination.credentialsFile;
  };

  systemd.timers.remote-development-workspace-backup = {
    description = "Run the encrypted operator workspace backup every day";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = workspaceBackupInventory.schedule.onCalendar;
      Persistent = true;
      RandomizedDelaySec = workspaceBackupInventory.schedule.randomizedDelaySeconds;
      Unit = "remote-development-workspace-backup.service";
    };
  };

  security.wrappers.netdata-ebpf = {
    source = "${netdataPackage}/libexec/netdata/plugins.d/ebpf.plugin.org";
    setuid = true;
    owner = "root";
    group = "netdata";
    permissions = "u+rx,g+x,o-rwx";
  };

  systemd.services.netdata = {
    serviceConfig = {
      EnvironmentFile = "-${observabilitySecretsDirectory}/netdata.env";
      MemoryHigh = "320M";
      MemoryMax = "384M";
    };
  };

  systemd.services.remote-development-kubernetes-api-proxy = {
    description = "Expose kube-state-metrics to host collectors through the K3s API";
    after = [ "k3s.service" ];
    requires = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = ''
        ${pkgs.k3s}/bin/k3s kubectl \
          --kubeconfig=/etc/rancher/k3s/k3s.yaml \
          proxy \
          --address=127.0.0.1 \
          --port=18080 \
          --accept-paths=^/api/v1/namespaces/observability/services/http:kube-state-metrics:8080/proxy/metrics$
      '';
      Restart = "on-failure";
      RestartSec = "5s";
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
    };
  };

  systemd.services.remote-development-observability-metrics = {
    description = "Publish remote-development workspace metrics to Netdata";
    after = [
      "k3s.service"
      "netdata.service"
      "remote-development-kubernetes-api-proxy.service"
      "remote-development-project-quotas.service"
    ];
    wants = [
      "k3s.service"
      "netdata.service"
      "remote-development-kubernetes-api-proxy.service"
    ];
    serviceConfig = {
      Type = "oneshot";
      RuntimeDirectory = "remote-development-observability";
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
      ReadOnlyPaths = [
        dataMount
        "/var/lib/remote-development-backup"
      ];
    };
    path = [
      pkgs.coreutils
      pkgs.curl
      pkgs.gawk
      pkgs.jq
      pkgs.quota
      pkgs.systemd
    ];
    environment.REMOTE_DEVELOPMENT_OBSERVABILITY_CONFIG =
      "/etc/remote-development-observability/metrics.env";
    script = "${observabilityMetrics}/bin/remote-development-observability-metrics";
  };

  systemd.timers.remote-development-observability-metrics = {
    description = "Refresh remote-development workspace metrics every minute";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "2m";
      OnUnitActiveSec = "1m";
      AccuracySec = "10s";
      Unit = "remote-development-observability-metrics.service";
    };
  };

  systemd.services.remote-development-healthcheck-heartbeat = {
    description = "Send the external remote-development host heartbeat";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.ConditionPathExists =
      "${observabilitySecretsDirectory}/healthchecks.env";
    path = [ pkgs.curl ];
    serviceConfig = {
      Type = "oneshot";
      EnvironmentFile = "${observabilitySecretsDirectory}/healthchecks.env";
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
    };
    script = ''
      test -n "''${HEALTHCHECKS_PING_URL:-}"
      curl \
        --fail \
        --silent \
        --show-error \
        --max-time 10 \
        --retry 2 \
        --retry-delay 2 \
        --request POST \
        --data "" \
        "''${HEALTHCHECKS_PING_URL}"
    '';
  };

  systemd.timers.remote-development-healthcheck-heartbeat = {
    description = "Send the remote-development host heartbeat every minute";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "1m";
      OnUnitActiveSec = "1m";
      AccuracySec = "10s";
      Unit = "remote-development-healthcheck-heartbeat.service";
    };
  };

  systemd.services.remote-development-k3s-state-migration = {
    description = "Migrate legacy K3s state to the root disk";
    after = [ "srv-remote\\x2ddevelopment.mount" ];
    requires = [ "srv-remote\\x2ddevelopment.mount" ];
    before = [
      "k3s.service"
      "remote-development-k3s-local-links.service"
    ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.coreutils ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      legacy=${dataMount}/k3s
      target=/var/lib/rancher/k3s
      staging=/var/lib/rancher/k3s.migrating

      if [ -e "$target" ] || [ ! -d "$legacy" ]; then
        exit 0
      fi

      test -s "$legacy/server/db/state.db"
      install -d -m 0755 /var/lib/rancher
      cleanup_staging() {
        rm -rf -- "$staging"
      }
      trap cleanup_staging EXIT
      rm -rf -- "$staging"
      cp -a -- "$legacy" "$staging"
      test -s "$staging/server/db/state.db"
      sync -f "$staging"
      mv -- "$staging" "$target"
      test -s "$target/server/db/state.db"
      trap - EXIT
    '';
  };

  systemd.services.remote-development-k3s-local-links = {
    description = "Keep migrated K3s symlinks on the root disk";
    after = [ "remote-development-k3s-state-migration.service" ];
    requires = [ "remote-development-k3s-state-migration.service" ];
    before = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    path = [
      pkgs.coreutils
      pkgs.findutils
      pkgs.gnugrep
      pkgs.gnused
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      if [ ! -d /var/lib/rancher/k3s ]; then
        exit 0
      fi

      while IFS= read -r -d "" link; do
        target="$(readlink -f "$link" || true)"
        case "$target" in
          /srv/remote-development/k3s/*)
            replacement="/var/lib/rancher/k3s/''${target#/srv/remote-development/k3s/}"
            test -e "$replacement"
            ln -sfn -- "$replacement" "$link"
            ;;
        esac
      done < <(find /var/lib/rancher/k3s -type l -print0)

      if [ -d /var/lib/rancher/k3s/server/cred ]; then
        while IFS= read -r -d "" kubeconfig; do
          if grep -qF /srv/remote-development/k3s "$kubeconfig"; then
            sed -E -i \
              's#^([[:space:]]*(certificate-authority|client-certificate|client-key):[[:space:]]*)/srv/remote-development/k3s#\1/var/lib/rancher/k3s#' \
              "$kubeconfig"
            ! grep -qF /srv/remote-development/k3s "$kubeconfig"
          fi
        done < <(
          find /var/lib/rancher/k3s/server/cred \
            -type f \
            -name '*.kubeconfig' \
            -print0
        )
      fi
    '';
  };

  systemd.services.k3s = {
    after = [
      "srv-remote\\x2ddevelopment.mount"
      "remote-development-data-layout.service"
      "remote-development-k3s-local-links.service"
      "remote-development-project-quotas.service"
    ];
    requires = [
      "srv-remote\\x2ddevelopment.mount"
      "remote-development-data-layout.service"
      "remote-development-k3s-local-links.service"
      "remote-development-project-quotas.service"
    ];
  };

  systemd.services.t3-code-tailscale-serve = {
    description = "Publish t3-code to the tailnet with Tailscale Serve";
    after = [
      "k3s.service"
      "tailscaled.service"
    ];
    wants = [
      "k3s.service"
      "tailscaled.service"
    ];
    wantedBy = [ "multi-user.target" ];
    path = [
      pkgs.jq
      pkgs.tailscale
    ];
    script = ''
      if tailscale status --json | jq --exit-status '.BackendState == "Running"' >/dev/null; then
        tailscale serve reset
        tailscale serve --bg --https=443 http://127.0.0.1:30773
        tailscale serve --bg --https=3000 http://127.0.0.1:31000
        tailscale serve --bg --https=3001 http://127.0.0.1:31001
        tailscale serve --bg --https=3002 http://127.0.0.1:31002
        tailscale serve --bg --https=3003 http://127.0.0.1:31003
        tailscale serve --bg --https=3004 http://127.0.0.1:31004
        tailscale serve --bg --https=19999 http://127.0.0.1:19999
      else
        echo "Tailscale is not enrolled; Serve will be configured after enrollment"
      fi
    '';
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      Restart = "on-failure";
      RestartSec = "30s";
    };
  };

  environment.systemPackages = with pkgs; [
    bind
    cryptsetup
    curl
    e2fsprogs
    git
    gh
    htop
    jq
    k3s
    kubectl
    kubernetes-helm
    kustomize
    less
    lsof
    mtr
    neovim
    quota
    restic
    ripgrep
    rsync
    tmux
    tree
    workspaceBackup
    workspaceBackupStatus
    workspaceExport
    workspaceRestore
    observabilityMetrics
  ];

  nix = {
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      auto-optimise-store = true;
    };
    gc = {
      automatic = true;
      dates = "Sun 04:15";
      options = "--delete-older-than 30d";
    };
  };

  system.autoUpgrade.enable = false;
  time.timeZone = "Europe/London";
  system.stateVersion = "25.11";
}
