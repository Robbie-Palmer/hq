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
  operatorKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIj4+tNshoonWcOZFnSV0YcXgKuGqfcmn5HyIvLCfdQe robbiepalmer@live.co.uk";
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
  ];

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
    ripgrep
    rsync
    tmux
    tree
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
