{
  disko.devices.disk.root = {
    type = "disk";
    # Verified on the MSI Vector GP68HX 13VH. Do not replace this with /dev/nvme0n1.
    device = "/dev/disk/by-id/nvme-eui.e8238fa6bf530001001b448b4a0a7d9e";
    content = {
      type = "gpt";
      partitions = {
        ESP = {
          size = "1G";
          type = "EF00";
          content = {
            type = "filesystem";
            format = "vfat";
            mountpoint = "/boot";
            mountOptions = [ "umask=0077" ];
          };
        };
        root = {
          size = "100%";
          content = {
            type = "luks";
            name = "vector-development-root";
            passwordFile = "/tmp/vector-development-luks.key";
            settings.allowDiscards = true;
            content = {
              type = "filesystem";
              format = "ext4";
              extraArgs = [
                "-O"
                "project,quota"
                "-E"
                "quotatype=prjquota"
              ];
              mountpoint = "/";
              mountOptions = [
                "noatime"
                "prjquota"
              ];
            };
          };
        };
      };
    };
  };
}
