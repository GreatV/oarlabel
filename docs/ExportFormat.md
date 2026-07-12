# Export Data Formats

This document describes the data formats exported by oarlabel for text detection, text recognition, formula recognition, and layout detection. The exported data can be used to train the corresponding PaddleOCR models. Specify the relevant image directories and annotation files in the PaddleOCR training configuration. All paths in the examples are relative to the export directory.

## Export Types

### Text Detection

Directory structure:

```text
output/
  images/
    page.png
  train.txt
  val.txt
```

Each line in `train.txt` and `val.txt` represents one image. The image path and annotation data are separated by a tab character (`\t`), not spaces:

```text
images/page.png	[{"transcription":"Sample text","points":[[10,20],[200,20],[200,60],[10,60]],"difficult":false}]
```

The annotation data is a JSON array in which each element represents one text region:

- `transcription`: text content
- `points`: vertex coordinates of the text region
- `difficult`: whether the region is marked as a difficult sample

### Text Recognition

Directory structure:

```text
output/
  train/
    img_000000.jpg
  val/
    img_000001.jpg
  train_list.txt
  val_list.txt
```

Each line in `train_list.txt` and `val_list.txt` contains the relative path to a cropped image and its corresponding text. The two fields are separated by a tab character (`\t`), not spaces:

```text
train/img_000000.jpg	Sample text
```

### Formula Recognition

Directory structure:

```text
output/
  train/
    formula_000000.png
  val/
    formula_000001.png
  train_list.txt
  val_list.txt
```

Each line in `train_list.txt` and `val_list.txt` contains the relative path to a cropped formula image and its corresponding formula text. The two fields are separated by a tab character (`\t`), not spaces:

```text
train/formula_000000.png	\frac{1}{2}
```

### Layout Detection

Directory structure:

```text
output/
  images/
    page.png
  annotations/
    train.json
    val.json
```

`train.json` and `val.json` use the COCO Detection format and contain:

- `images`: image file names, widths, and heights
- `annotations`: region coordinates, bounding boxes, areas, and category IDs
- `categories`: category IDs and names
